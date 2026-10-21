'use strict';

// Ids of root resources that `node` references through Ref / Fn::GetAtt / Fn::Sub.
function collectReferences(node, resources, found) {
  if (Array.isArray(node)) {
    node.forEach(child => collectReferences(child, resources, found));
    return found;
  }

  if (!node || typeof node !== 'object') return found;

  if (typeof node.Ref === 'string' && node.Ref in resources) found.add(node.Ref);

  const getAtt = node['Fn::GetAtt'];
  if (getAtt) {
    const id = Array.isArray(getAtt) ? getAtt[0] : String(getAtt).split('.')[0];
    if (id in resources) found.add(id);
  }

  const sub = node['Fn::Sub'];
  const template = Array.isArray(sub) ? sub[0] : sub;
  if (typeof template === 'string') {
    for (const match of template.matchAll(/\$\{([A-Za-z0-9]+)/g)) {
      if (match[1] in resources) found.add(match[1]);
    }
  }

  Object.values(node).forEach(child => collectReferences(child, resources, found));
  return found;
}

function directDependencies(resources, logicalId) {
  const resource = resources[logicalId] || {};
  const found = new Set([].concat(resource.DependsOn || []));

  return collectReferences(resource.Properties, resources, found);
}

// True when `from` already waits on `target`, directly or through other resources.
function dependsOn(resources, from, target) {
  const seen = new Set();
  const queue = [from];

  while (queue.length) {
    const current = queue.shift();
    if (current === target) return true;
    if (!seen.has(current)) {
      seen.add(current);
      directDependencies(resources, current).forEach(id => queue.push(id));
    }
  }

  return false;
}

module.exports = function sequenceStacks() {
  if (
    this.config.stackConcurrency
    && typeof this.config.stackConcurrency === 'number'
    && Number.isInteger(this.config.stackConcurrency)
    && this.config.stackConcurrency > 0
  ) {
    const stackConcurrency = this.config.stackConcurrency;
    const resources = this.rootTemplate.Resources;

    const stackLogicalIds = Object.keys(this.nestedStacks);

    stackLogicalIds.forEach((logicalId, index) => {
      const resource = resources[logicalId];
      let parentLogicalId = null;

      if (index >= stackConcurrency) {
        parentLogicalId = stackLogicalIds[index - stackConcurrency];
      }

      // The chain only limits how many stacks deploy at once, so dropping a link is
      // safe. Adding one whose parent already waits on this stack (through a
      // cross-stack reference or an earlier link) makes the template circular, and
      // CloudFormation rejects the whole deploy.
      if (parentLogicalId && dependsOn(resources, parentLogicalId, logicalId)) {
        if (typeof this.log === 'function') {
          this.log(`Not chaining ${logicalId} after ${parentLogicalId}: it would make a circular dependency`);
        }
        parentLogicalId = null;
      }

      if (parentLogicalId) {
        let dependsOnIds = [parentLogicalId];

        if (resource.DependsOn) {
          dependsOnIds = dependsOnIds.concat(resource.DependsOn)
        }

        resource.DependsOn = dependsOnIds;
      }
    })
  }
};
