/**
 * @fileoverview Three.js Application Entry Point
 *
 * Initializes the Three.js renderer and wires it to the Alpine.js control panel.
 * This replaces the previous Pixi.js setup — the interface and observer pattern remain identical.
 *
 * Runs after Alpine.js loads so that simControl() is available globally.
 */
import Renderer from './rendering/Renderer.js';

// Wait for Alpine to initialize, then set up the Renderer
window.addEventListener('load', async () => {
  // Alpine should be available by now
  if (typeof Alpine === 'undefined') {
    console.warn('Alpine.js not loaded yet, retrying...');
    return;
  }

  // Get DOM elements
  const canvasContainer = document.getElementById('canvas-container');
  const healthCanvas = document.getElementById('health-chart');
  const needsCanvas = document.getElementById('needs-chart');

  if (!canvasContainer || !healthCanvas || !needsCanvas) {
    console.error('Required DOM elements not found');
    return;
  }

  // Instantiate the Three.js Renderer
  const renderer = new Renderer({
    canvasContainer,
    healthCanvas,
    needsCanvas,
  });

  // Initialize asynchronously
  try {
    await renderer.init();
    window.simRenderer = renderer; // Expose to Alpine.js
  } catch (err) {
    console.error('Failed to initialize Three.js renderer:', err);
  }
});
