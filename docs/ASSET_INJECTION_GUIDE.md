# Asset Injection Guide: Swapping Primitives for Custom 3D Models

This guide explains how to replace the primitive-based 3D meshes (spheres, cylinders, boxes) with your own custom 3D asset files (`.glb`, `.gltf`, `.obj`, etc.) when you're ready to do so.

---

## Overview

The current Three.js rendering system uses procedural geometry primitives to represent all ward objects and agents:
- **Patients**: Spheres (white)
- **Nurses**: Cylinders (green)
- **MEDi robots**: Cylinders (blue)
- **BLANKi robots**: Cylinders (orange)
- **EDi robots**: Cylinders (purple)
- **Ward cells**: Planes (corridors, beds, stations) and boxes (walls)

These primitives are created inside isolated **factory functions** designed for easy replacement.

---

## Injection Points

### 1. **Agent Meshes** — `src/rendering/AgentMeshes.js`

#### Patient Mesh Factory
**File:** [src/rendering/AgentMeshes.js](src/rendering/AgentMeshes.js#L132-L145)  
**Current code:**
```javascript
if (type === 'patient') {
  // Patients: small white sphere
  geometry = new THREE.SphereGeometry(config.radius, 16, 16);
}
```

**To replace with a custom model:**
```javascript
if (type === 'patient') {
  // Load custom patient model
  const loader = new THREE.GLTFLoader();
  const gltf = await loader.loadAsync('/assets/patient.glb');
  const mesh = gltf.scene.children[0];  // Assume first child is the mesh
  mesh.scale.set(config.radius / 0.5, config.radius / 0.5, config.radius / 0.5);
  return mesh;
}
```

#### Nurse/Robot Mesh Factory
**File:** [src/rendering/AgentMeshes.js](src/rendering/AgentMeshes.js#L132-L148)  
**Current code:**
```javascript
} else {
  // Nurses & robots: cylinders
  geometry = new THREE.CylinderGeometry(config.radius, config.radius, config.height, 16);
}
```

**To replace with custom models by type:**
```javascript
} else {
  // Load model based on agent type
  const loader = new THREE.GLTFLoader();
  let modelPath = '/assets/nurse.glb';
  if (type === 'medi') modelPath = '/assets/robot-medi.glb';
  else if (type === 'blanki') modelPath = '/assets/robot-blanki.glb';
  else if (type === 'edi') modelPath = '/assets/robot-edi.glb';
  
  const gltf = await loader.loadAsync(modelPath);
  const mesh = gltf.scene.children[0];
  mesh.scale.set(config.radius / 0.25, config.height / 0.7, config.radius / 0.25);
  return mesh;
}
```

---

### 2. **Ward Grid Cells** — `src/rendering/GridRenderer.js`

#### Floor/Corridor Plane Factory
**File:** [src/rendering/GridRenderer.js](src/rendering/GridRenderer.js#L65-L80)  
**Current code:**
```javascript
_createPlaneMesh(color, x, z, cellSize) {
  const geometry = new THREE.PlaneGeometry(cellSize, cellSize);
  const material = new THREE.MeshStandardMaterial({...});
  // ...
}
```

**To replace with tiled textures:**
```javascript
_createPlaneMesh(color, x, z, cellSize) {
  const loader = new THREE.TextureLoader();
  const texture = await loader.loadAsync('/assets/floor-tile.png');
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const geometry = new THREE.PlaneGeometry(cellSize, cellSize);
  // ...
}
```

#### Wall Mesh Factory
**File:** [src/rendering/GridRenderer.js](src/rendering/GridRenderer.js#L82-L95)  
**Current code:**
```javascript
_createWallMesh(color, x, z, cellSize, height) {
  const geometry = new THREE.BoxGeometry(cellSize, height, cellSize);
  const material = new THREE.MeshStandardMaterial({...});
  // ...
}
```

**To replace with architectural models:**
```javascript
_createWallMesh(color, x, z, cellSize, height) {
  const loader = new THREE.GLTFLoader();
  const gltf = await loader.loadAsync('/assets/wall-segment.glb');
  const mesh = gltf.scene;
  mesh.position.set(x + cellSize / 2, height / 2, z + cellSize / 2);
  mesh.scale.set(cellSize / 1.0, height / 1.5, cellSize / 1.0);
  return mesh;
}
```

---

## Implementation Strategy

### **Quick Start (Canvas Approach)**

If you want to keep using procedural meshes but with better visual fidelity:

1. **Use procedural geometry with better materials:**
   ```javascript
   const material = new THREE.MeshStandardMaterial({
     color: config.color,
     roughness: 0.4,        // Shinier
     metalness: 0.5,        // More metallic
     envMapIntensity: 1.0,  // Reflective
   });
   ```

2. **Add normal maps to increase perceived detail** (without loading models):
   ```javascript
   const normalMap = new THREE.TextureLoader().load('/assets/normal-map.png');
   material.normalMap = normalMap;
   ```

---

### **Full Custom Assets (GLTFLoader Approach)**

This is the recommended path when you have real 3D models ready.

1. **Install GLTFLoader into a `lib/` folder (optional, if not using CDN):**
   ```bash
   # Already available via CDN, so no installation needed
   # Just import it via the importmap in index.html
   ```

2. **Update the importmap in `index.html`:**
   ```html
   <script type="importmap">{
     "imports": {
       "three": "https://cdn.jsdelivr.net/npm/three@r128/build/three.module.js",
       "three/addons/": "https://cdn.jsdelivr.net/npm/three@r128/examples/jsm/",
       "GLTFLoader": "https://cdn.jsdelivr.net/npm/three@r128/examples/jsm/loaders/GLTFLoader.js"
     }
   }</script>
   ```

3. **Import and use in AgentMeshes.js:**
   ```javascript
   import { GLTFLoader } from 'GLTFLoader';
   
   // Inside _createBodyMesh():
   const loader = new GLTFLoader();
   const gltf = await loader.loadAsync('/assets/patient.glb');
   return gltf.scene.children[0];
   ```

---

### **Important Considerations**

1. **Async loading:** The current `_createBodyMesh()` is synchronous. If loader is async, you may need to refactor:
   ```javascript
   // Make initMeshes() async and await _createAgent()
   async _createAgent(agent) {
     const bodyMesh = await this._createBodyMesh(type, config);
     // ...
   }
   ```

2. **Scale alignment:** Ensure your models fit within the expected coordinate space:
   - **Patients**: ~0.35 units radius
   - **Nurses/Robots**: ~0.25 units radius, ~0.7 units height
   - **Walls**: `cellSize × cellSize × 1.5` units

3. **LOD (Level of Detail):** For performance, use Three.js's `THREE.LOD` system:
   ```javascript
   const lod = new THREE.LOD();
   const meshHigh = await loader.loadAsync('/assets/model-high.glb');
   const meshLow = await loader.loadAsync('/assets/model-low.glb');
   lod.addLevel(meshHigh, 0);   // Show high detail when close
   lod.addLevel(meshLow, 10);   // Show low detail when far
   return lod;
   ```

4. **Instancing:** If you have many identical agents, use `THREE.InstancedMesh` instead of creating separate meshes for better performance:
   ```javascript
   const geometry = new THREE.BoxGeometry(1, 1, 1);
   const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
   const instancedMesh = new THREE.InstancedMesh(geometry, material, 32); // 32 instances
   // Update positions via .setMatrixAt(index, matrix)
   ```

---

## File Structure for Assets

Recommended directory layout:

```
sma-40015-final-project/
├── assets/
│   ├── agents/
│   │   ├── patient.glb
│   │   ├── nurse.glb
│   │   ├── robot-medi.glb
│   │   ├── robot-blanki.glb
│   │   └── robot-edi.glb
│   ├── ward/
│   │   ├── floor-tile.png
│   │   ├── wall-segment.glb
│   │   ├── bed.glb
│   │   └── charging-station.glb
│   └── textures/
│       ├── normal-map.png
│       └── floor-roughness.png
└── src/
    └── rendering/
        ├── AgentMeshes.js
        └── GridRenderer.js
```

---

## Testing Custom Assets

Once you've swapped in your models, test with:

1. **Visual inspection:**
   ```bash
   python -m http.server 8080
   # Open http://localhost:8080
   # Check that agents are visible and move smoothly
   ```

2. **Console errors:**
   - Check browser DevTools console for loader warnings
   - Look for missing textures or misaligned geometry

3. **Performance:**
   - Use Chrome DevTools → Performance tab to profile
   - Check for framerate drops when many agents are visible

4. **Simulation determinism:**
   - Swap custom assets should **NOT** affect KPI values
   - Run batch experiments and verify results match baseline

---

## Rollback

If custom assets cause problems, revert to primitives by undoing the changes in `AgentMeshes.js` and `GridRenderer.js`, or use Git:

```bash
git checkout src/rendering/AgentMeshes.js
git checkout src/rendering/GridRenderer.js
```

---

## Further Reading

- [Three.js GLTFLoader docs](https://threejs.org/docs/index.html#examples/en/loaders/GLTFLoader)
- [Three.js OBJLoader docs](https://threejs.org/docs/index.html#examples/en/loaders/OBJLoader)
- [Three.js LOD docs](https://threejs.org/docs/index.html#api/en/objects/LOD)
- [Best practices for model export](https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md)
