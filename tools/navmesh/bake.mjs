// Bake navmesh dari map greybox AABB (Fase B0 prototipe).
// Emit quad permukaan atas tiap box (walkable), bake solo navmesh, test query path.
import { init, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';
import { GREYBOX } from '../../packages/shared/src/config/map.ts';
import { writeFileSync } from 'node:fs';

await init();

function aabbToWalkableGeometry(boxes) {
  const positions = [];
  const quad = (a, b, c, d) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const b of boxes) {
    // permukaan atas (walkable)
    quad([b.minX, b.maxY, b.minZ], [b.minX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.maxZ], [b.maxX, b.maxY, b.minZ]);
  }
  const numVerts = positions.length / 3;
  return { positions: new Float32Array(positions), indices: new Uint32Array(Array.from({ length: numVerts }, (_, i) => i)) };
}

const { positions, indices } = aabbToWalkableGeometry(GREYBOX.boxes);
const { navMesh, success, error } = generateSoloNavMesh(positions, indices, {
  cs: 0.3,
  ch: 0.1,
  walkableSlopeAngle: 45,
  walkableHeight: 1.8,
  walkableClimb: 12,
  walkableRadius: 0.4,
  maxVertsPerPoly: 6,
});
if (!success) { console.error('BAKE GAGAL:', error); process.exit(1); }
console.log('bake OK');

const q = new NavMeshQuery(navMesh);

// Test 1: path spawn kiri → kanan
const r1 = q.computePath({ x: -30, y: 0, z: 0 }, { x: 30, y: 0, z: 0 });
console.log('path spawn→spawn:', r1.success, 'waypoints:', r1.path?.length, r1.path?.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`).join(' '));

// Test 2: path ke atas platform (step 0.5/1.0/2.0 via tangga box)
const r2 = q.computePath({ x: 0, y: 0, z: -30 }, { x: -16, y: 2, z: -16 });
console.log('path→platform(-16,-16):', r2.success, 'waypoints:', r2.path?.length, r2.path?.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)})`).join(' '));

// Test 3: random points (roam)
for (let i = 0; i < 3; i++) {
  const { randomPoint, success: ok } = q.findRandomPoint();
  console.log(`random[${i}]:`, ok, `(${randomPoint.x.toFixed(1)},${randomPoint.y.toFixed(1)},${randomPoint.z.toFixed(1)})`);
}

// Test 4: nearest poly (snap posisi keluar navmesh)
const n = q.findNearestPoly({ x: 100, y: 0, z: 100 });
console.log('nearest to (100,100):', n.success, n.point ? `(${n.point.x.toFixed(1)},${n.point.y.toFixed(1)},${n.point.z.toFixed(1)})` : '-');

// Simpan hasil bake sebagai GLB-like JSON untuk runtime client (B1: NavService)
import { getNavMeshPositionsAndIndices } from '@recast-navigation/core';
const [navPositions, navIndices] = getNavMeshPositionsAndIndices(navMesh);
const out = { name: GREYBOX.name, params: { cs: 0.3, ch: 0.1, walkableHeight: 1.8, walkableClimb: 12, walkableRadius: 0.4 }, positions: Array.from(navPositions), indices: Array.from(navIndices) };
writeFileSync('apps/client/public/assets/maps/greybox.navmesh.json', JSON.stringify(out));
console.log('navmesh saved:', navPositions.length / 3, 'verts,', navIndices.length / 3, 'tris');
