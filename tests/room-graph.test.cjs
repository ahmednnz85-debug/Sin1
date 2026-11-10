const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Graph = require('../room-graph.js');

const LINKS = [
  ['Palace', 'K1'], ['K1', 'KC12'], ['KC12', 'K2'], ['K2', 'KC1'], ['KC1', 'KC2'],
  ['KC2', 'K5'], ['KC1', 'KC3'], ['KC3', 'K3'], ['KC2', 'KC4'], ['KC4', 'K4'],
  ['K5', 'KC5R'], ['KC5R', 'REAR'], ['REAR', 'TR1'], ['TR1', 'T1'],
  ['T1', 'TC12'], ['TC12', 'T2'], ['T2', 'TC23'], ['TC23', 'T3'],
  ['T3', 'TC34'], ['TC34', 'T4'], ['T3', 'TC5'], ['TC5', 'T5'],
  ['Palace', 'T1'], ['Palace', 'L1'],
  ['L1', 'LC2'], ['LC2', 'L2'], ['L1', 'LC3'], ['LC3', 'L3'], ['L1', 'LC4'], ['LC4', 'L4'],
  ['T4', 'MP1'], ['MP1', 'MP2'], ['MP2', 'L4']
];

test('hub is permanent; neighbors of K2 are warm; far temple is cold', () => {
  const g = Graph.createGraph({
    links: LINKS,
    regionIds: ['K1', 'KC12', 'K2', 'KC1', 'K3', 'KC3', 'K4', 'KC4', 'K5', 'T1', 'T2', 'L1']
  });
  const snap = g.classify('K2');
  assert.equal(snap.states.get('Palace'), 'permanent');
  assert.equal(snap.states.get('K2'), 'active');
  assert.equal(snap.states.get('KC12'), 'warm');
  assert.equal(snap.states.get('KC1'), 'warm');
  assert.equal(snap.states.get('K1'), 'cold'); // two hops via KC12
  assert.equal(snap.states.get('T2'), 'cold');
  const resident = g.residentIds(snap);
  assert.equal(resident.has('Palace'), true);
  assert.equal(resident.has('K2'), true);
  assert.equal(resident.has('KC12'), true);
  assert.equal(resident.has('T2'), false);
});

test('camera-visible far room is promoted to warm', () => {
  const g = Graph.createGraph({ links: LINKS, regionIds: ['K1', 'K2', 'T4'] });
  const snap = g.classify('K1', { visible: new Set(['T4']) });
  assert.equal(snap.states.get('T4'), 'warm');
});

test('rear gallery connects kings to temple; moon passage connects T4 to L4', () => {
  const g = Graph.createGraph({ links: LINKS, regionIds: ['K5', 'REAR', 'T1', 'T4', 'MP1', 'MP2', 'L4'] });
  const fromK5 = g.hopsFrom('K5', 8);
  // K5 → KC5R → REAR → TR1 → T1
  assert.equal(fromK5.get('T1'), 4);
  const fromT4 = g.hopsFrom('T4', 6);
  // T4 → MP1 → MP2 → L4
  assert.equal(fromT4.get('L4'), 3);
});

test('index.html loads room-graph before wings', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const graph = html.indexOf('data-src="room-graph.js');
  const wings = html.indexOf('data-src="wings.js');
  assert.ok(graph > 0 && graph < wings);
});
