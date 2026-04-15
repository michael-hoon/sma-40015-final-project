/**
 * @fileoverview Creates and updates Three.js meshes for all agent types.
 * Each agent gets a Group holding:
 * - Main body mesh (sphere for patients, cylinder for nurses, box for robots)
 * - Optional text label as a canvas texture billboard
 * - Optional need indicator dots (small spheres)
 * - Optional inventory bar (plane above agent)
 *
 * Position interpolation works the same as Pixi version:
 * recordPositions() snapshots pre-tick ; update(lerpT) interpolates display.
 */
import * as THREE from 'three';

/** Agent mesh configurations */
const AGENT_CONFIG = {
  patient: {
    radius: 0.35,
    color: 0xffffff,
    label: '',
  },
  nurse: {
    radius: 0.25,
    height: 0.8,
    color: 0x2e7d32, // green
    label: 'N',
  },
  medi: {
    radius: 0.22,
    height: 0.7,
    color: 0x1565c0, // blue
    label: 'M',
  },
  blanki: {
    radius: 0.22,
    height: 0.7,
    color: 0xef6c00, // orange
    label: 'B',
  },
  edi: {
    radius: 0.22,
    height: 0.7,
    color: 0x7b1fa2, // purple
    label: 'E',
  },
};

/** Need dot colours */
const NEED_COLORS = {
  emergency:      0xf44336,
  medication:     0x2196f3,
  comfort:        0xff9800,
  visitor_escort: 0x9c27b0,
};

const NEED_ORDER = ['emergency', 'medication', 'comfort', 'visitor_escort'];

/**
 * Infer agent type from id string
 */
function agentType(id) {
  if (id.startsWith('patient_')) return 'patient';
  if (id.startsWith('nurse_'))   return 'nurse';
  if (id.startsWith('medi_'))    return 'medi';
  if (id.startsWith('blanki_'))  return 'blanki';
  if (id.startsWith('edi_'))     return 'edi';
  return 'nurse';
}

/**
 * Compute refill progress 0–1
 */
function refillProgress(agent) {
  if (!agent.totalRefillTicks) return 0;
  return Math.max(0, Math.min(1,
    (agent.totalRefillTicks - agent.refillTicksRemaining) / agent.totalRefillTicks,
  ));
}

export default class AgentMeshes {
  /**
   * @param {object} params
   * @param {THREE.Scene} params.scene
   * @param {number} params.cellSize - Units per grid cell
   */
  constructor({ scene, cellSize }) {
    this.scene = scene;
    this.cellSize = cellSize;

    /**
     * Keyed by agent id.
     * Stores: { group: THREE.Group, meshes: {...}, prevPos: {x,y}, currPos: {x,y} }
     */
    this._agents = new Map();
  }

  /**
   * Create meshes for all agents. Call once per simulation init/reset.
   */
  initMeshes(patients, nurses, robots) {
    // Clean up existing meshes
    for (const [, data] of this._agents) {
      this.scene.remove(data.group);
      this._disposeGroup(data.group);
    }
    this._agents.clear();

    // Create meshes for all agents
    for (const agent of [...patients, ...nurses, ...robots]) {
      this._createAgent(agent);
    }
  }

  /**
   * @private
   * Dispose all geometries and materials in a group
   */
  _disposeGroup(group) {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        obj.material?.dispose();
      }
    });
  }

  /**
   * @private
   * Create meshes for a single agent
   */
  _createAgent(agent) {
    const type = agentType(agent.id);
    const config = AGENT_CONFIG[type];
    const group = new THREE.Group();

    // Create main body mesh
    const bodyMesh = this._createBodyMesh(type, config);
    group.add(bodyMesh);

    // Create label as canvas texture billboard (optional)
    if (config.label) {
      const labelMesh = this._createLabelMesh(config.label, config.radius);
      group.add(labelMesh);
    }

    // Create need dots container (patients only)
    let needDotsGroup = null;
    if (type === 'patient') {
      needDotsGroup = new THREE.Group();
      group.add(needDotsGroup);
    }

    // Create inventory bar (nurses + robots with inventory)
    let invBarMesh = null;
    if (type === 'nurse' || type === 'medi' || type === 'blanki') {
      invBarMesh = this._createInventoryBar(config.radius);
      group.add(invBarMesh);
    }

    // Position in world
    const worldX = agent.position.x * this.cellSize;
    const worldZ = agent.position.y * this.cellSize;
    group.position.set(worldX, config.radius, worldZ); // y = radius so bottom is at y=0

    this.scene.add(group);

    this._agents.set(agent.id, {
      group,
      type,
      bodyMesh,
      needDotsGroup,
      invBarMesh,
      prevPos: { ...agent.position },
      currPos: { ...agent.position },
    });
  }

  /**
   * @private
   * Create the main body mesh (sphere, cylinder, or box)
   */
  _createBodyMesh(type, config) {
    let geometry, material;

    const baseColor = new THREE.Color(config.color);
    material = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.6,
      metalness: 0.2,
    });

    if (type === 'patient') {
      // Patients: small white sphere
      geometry = new THREE.SphereGeometry(config.radius, 16, 16);
    } else {
      // Nurses & robots: cylinders
      geometry = new THREE.CylinderGeometry(config.radius, config.radius, config.height, 16);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * @private
   * Create a label as a canvas texture billboard plane
   */
  _createLabelMesh(text, radius) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshStandardMaterial({ map: texture, emissive: 0x444444 });
    const geometry = new THREE.PlaneGeometry(radius * 1.8, radius * 1.8);
    const plane = new THREE.Mesh(geometry, material);
    plane.position.z = radius * 0.5; // Slight offset so label is visible
    return plane;
  }

  /**
   * @private
   * Create an inventory bar (positioned above the agent)
   */
  _createInventoryBar(radius) {
    const barWidth = radius * 2.2;
    const barHeight = radius * 0.3;
    const geometry = new THREE.PlaneGeometry(barWidth, barHeight);
    const material = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.y = radius + barHeight / 2;
    plane.castShadow = false;
    plane.receiveShadow = false;
    return plane;
  }

  /**
   * Record logical positions before tick
   */
  recordPositions(patients, nurses, robots) {
    for (const agent of [...patients, ...nurses, ...robots]) {
      const data = this._agents.get(agent.id);
      if (!data) continue;
      data.prevPos = { ...data.currPos };
      data.currPos = { ...agent.position };
    }
  }

  /**
   * Update display: interpolate positions, redraw need dots, update inventory bars
   */
  update(lerpT, patients, nurses, robots, allNeeds) {
    const cs = this.cellSize;
    const t = Math.max(0, Math.min(1, lerpT));

    // Build needs-by-patient map
    const needsByPatient = new Map();
    for (const need of allNeeds) {
      if (need.status === 'fulfilled') continue;
      if (!needsByPatient.has(need.patientId)) needsByPatient.set(need.patientId, []);
      needsByPatient.get(need.patientId).push(need);
    }

    // Update positions
    for (const [, data] of this._agents) {
      const px = data.prevPos.x + (data.currPos.x - data.prevPos.x) * t;
      const pz = data.prevPos.y + (data.currPos.y - data.prevPos.y) * t;
      data.group.position.x = px * cs;
      data.group.position.z = pz * cs;
    }

    // Update patient need dots
    for (const patient of patients) {
      const data = this._agents.get(patient.id);
      if (!data || !data.needDotsGroup) continue;
      const needs = needsByPatient.get(patient.id) ?? [];
      this._updateNeedDots(data.needDotsGroup, needs);
    }

    // Update inventory bars
    for (const nurse of nurses) {
      const data = this._agents.get(nurse.id);
      if (!data || !data.invBarMesh) continue;
      this._updateInventoryBar(data.invBarMesh, nurse.medicineCount, nurse.blanketCount, nurse.state);
    }

    for (const robot of robots) {
      const data = this._agents.get(robot.id);
      if (!data || !data.invBarMesh) continue;
      const type = agentType(robot.id);
      if (type === 'medi') {
        const frac = robot.state === 'REFILLING'
          ? refillProgress(robot)
          : robot.medicineCount / (robot.config?.MEDI_ITEM_CAPACITY || 1);
        this._updateInventoryBar(data.invBarMesh, frac, 0, robot.state);
      } else if (type === 'blanki') {
        const frac = robot.state === 'REFILLING'
          ? refillProgress(robot)
          : robot.blanketCount / (robot.config?.BLANKI_ITEM_CAPACITY || 1);
        this._updateInventoryBar(data.invBarMesh, 0, frac, robot.state);
      }
    }
  }

  /**
   * @private
   * Update or create need indicator dots around a patient
   */
  _updateNeedDots(group, needs) {
    // Clear existing dots
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        obj.material?.dispose();
        group.remove(obj);
      }
    });

    const toShow = NEED_ORDER.filter(t => needs.some(n => n.type === t));
    if (toShow.length === 0) return;

    const dotRadius = 0.08;
    const spacing = 0.22;
    const totalW = (toShow.length - 1) * spacing;
    const startX = -totalW / 2;

    toShow.forEach((type, i) => {
      const need = needs.find(n => n.type === type);
      const isClaimed = need.status === 'claimed' || need.status === 'in_progress';

      const geometry = new THREE.SphereGeometry(dotRadius, 8, 8);
      const material = new THREE.MeshStandardMaterial({
        color: NEED_COLORS[type],
        emissive: isClaimed ? 0x000000 : new THREE.Color(NEED_COLORS[type]).multiplyScalar(0.3),
        opacity: isClaimed ? 0.45 : 1.0,
        transparent: isClaimed,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(startX + i * spacing, 0.3, 0);
      group.add(mesh);
    });
  }

  /**
   * @private
   * Update inventory bar color/appearance based on current inventory and state
   */
  _updateInventoryBar(barMesh, medicineOrFrac, blanketFrac, state) {
    if (!barMesh) return;

    // For simplicity, we'll update the material color to blend medicine/blanket colors
    // based on current inventory. Full animation would require updating material
    // with a canvas texture or custom shader.
    const hasAny = medicineOrFrac > 0 || blanketFrac > 0;
    const color = new THREE.Color(0x333333);

    if (medicineOrFrac > 0 && blanketFrac === 0) {
      color.setHex(0x64b5f6); // medicine blue
    } else if (blanketFrac > 0 && medicineOrFrac === 0) {
      color.setHex(0xffb74d); // blanket orange
    } else if (medicineOrFrac > 0 && blanketFrac > 0) {
      // Blend: interpolate between blue and orange
      const blueColor = new THREE.Color(0x64b5f6);
      const orangeColor = new THREE.Color(0xffb74d);
      color.lerpColors(blueColor, orangeColor, 0.5);
    }

    if (barMesh.material instanceof THREE.MeshStandardMaterial) {
      barMesh.material.color = color;
    }
  }

  /** Clean up all meshes */
  destroy() {
    for (const [, data] of this._agents) {
      this.scene.remove(data.group);
      this._disposeGroup(data.group);
    }
    this._agents.clear();
  }
}
