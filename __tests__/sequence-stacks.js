'use strict';

const test = require('ava');

const sequenceStacks = require('../lib/sequence-stacks');

const countDependsOn = function (resources) {
  return Object.keys(resources).filter(resourceName => resources[resourceName].DependsOn).length
};

const doesNotBecomeCircular = function (resources) {
  const memo = {};

  Object.keys(resources).forEach(resourceName => {
    const resource = resources[resourceName];
    if (resource.DependsOn) {
      resource.DependsOn.forEach(parent => {
        if (!memo[parent]) {
          memo[parent] = [resourceName];
        } else {
          memo[parent].push(resourceName);
        }
      });
    }
  });

  return Object.keys(memo).every(parentName => memo[parentName].length <= 1);
};

test.beforeEach(t => {
  t.context = Object.assign({ sequenceStacks }, {
    config: {},
    serverless: {
      config: {
        servicePath: __dirname
      }
    },
    provider: {},
    getStackName: () => 'test',
    nestedStacks: {
      '1NestedStack': {},
      '2NestedStack': {},
      '3NestedStack': {},
      '4NestedStack': {},
      '5NestedStack': {},
      '6NestedStack': {},
      '7NestedStack': {},
      '8NestedStack': {},
      '9NestedStack': {},
      '10NestedStack': {}
    },
    rootTemplate: {
      Resources: {
        '1NestedStack': {},
        '2NestedStack': {},
        '3NestedStack': {},
        '4NestedStack': {},
        '5NestedStack': {},
        '6NestedStack': {},
        '7NestedStack': {},
        '8NestedStack': {},
        '9NestedStack': {},
        '10NestedStack': {}
      }
    }
  });
});

test('does nothing if parallelDeployments is disabled', t => {
  t.context.config.stackConcurrency = 0;

  t.context.sequenceStacks();

  t.is(0, countDependsOn(t.context.rootTemplate.Resources));
});

test('creates a single nested stack chain if enabled without parallel deployments', t => {
  t.context.config.stackConcurrency = 1;

  t.context.sequenceStacks();

  t.is(9, countDependsOn(t.context.rootTemplate.Resources));
  t.true(doesNotBecomeCircular(t.context.rootTemplate.Resources));
});

test('keeps already existing dependsOn directives', t => {
  t.context.config.stackConcurrency = 1;
  t.context.rootTemplate.Resources['9NestedStack'].DependsOn = ['Foo'];

  t.context.sequenceStacks();

  t.is(9, countDependsOn(t.context.rootTemplate.Resources));
  t.is(2, t.context.rootTemplate.Resources['9NestedStack'].DependsOn.length);
  t.true(doesNotBecomeCircular(t.context.rootTemplate.Resources));
});

test('creates multiple nested stack chains if enabled with parallel deployments', t => {
  t.context.config.stackConcurrency = 3;

  t.context.sequenceStacks();

  t.is(7, countDependsOn(t.context.rootTemplate.Resources));
  t.true(doesNotBecomeCircular(t.context.rootTemplate.Resources));
});

const isAcyclic = function (resources) {
  const state = {};
  const visit = name => {
    if (state[name] === 1) return false;
    if (state[name] === 2) return true;
    state[name] = 1;
    const ok = [].concat((resources[name] || {}).DependsOn || []).every(visit);
    state[name] = 2;
    return ok;
  };
  return Object.keys(resources).every(visit);
};

test('skips a chain link that would close a loop with a cross-stack dependency', t => {
  t.context.config.stackConcurrency = 3;
  // 2 takes an output of 8; the chain 8 -> 5 -> 2 would make 8 wait on 2 as well.
  t.context.rootTemplate.Resources['2NestedStack'].DependsOn = ['8NestedStack'];

  t.context.sequenceStacks();

  const resources = t.context.rootTemplate.Resources;
  t.true(isAcyclic(resources));
  t.deepEqual(resources['8NestedStack'].DependsOn, undefined);
  t.deepEqual(resources['5NestedStack'].DependsOn, ['2NestedStack']);
  t.deepEqual(resources['2NestedStack'].DependsOn, ['8NestedStack']);
  // Unrelated chains are untouched.
  t.deepEqual(resources['7NestedStack'].DependsOn, ['4NestedStack']);
});

test('sees dependencies carried by Fn::GetAtt in nested stack parameters', t => {
  t.context.config.stackConcurrency = 3;
  t.context.rootTemplate.Resources['2NestedStack'].Properties = {
    Parameters: { ProductsOutput: { 'Fn::GetAtt': ['8NestedStack', 'Outputs.Arn'] } },
  };

  t.context.sequenceStacks();

  t.is(t.context.rootTemplate.Resources['8NestedStack'].DependsOn, undefined);
});
