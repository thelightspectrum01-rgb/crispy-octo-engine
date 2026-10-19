// Planar mirror reflection for the polished board. A virtual camera mirrored below the board
// renders only the reflection layer (pieces, shards, weapons, flames, sparks) into a texture
// that the board's marble samples with Fresnel weighting. Adapted from three.js' Reflector.
import * as THREE from 'three';

export const REFLECT_LAYER = 1;

export class PlanarReflection {
  constructor(renderer, {scale = 0.5, height = 0} = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(REFLECT_LAYER);
    const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.textureMatrix = new THREE.Matrix4();
    this.uniforms = {uReflection: {value: this.target.texture}, uReflectMatrix: {value: this.textureMatrix}};
    this.mirror = new THREE.Object3D();
    this.mirror.rotation.x = -Math.PI / 2; // local +Z (the mirror normal) points up
    this.mirror.position.y = height;
    this.mirror.updateMatrixWorld(true);
    this.lastCamera = new THREE.Matrix4();
    this.frame = 0;
    this.clearColor = new THREE.Color();
    // Scratch values reused every frame.
    this.v = {
      mirrorPos: new THREE.Vector3(), cameraPos: new THREE.Vector3(), rotation: new THREE.Matrix4(),
      normal: new THREE.Vector3(), view: new THREE.Vector3(), lookAt: new THREE.Vector3(),
      target: new THREE.Vector3(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(),
    };
  }

  setSize(width, height) {
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
    this.lastCamera.elements[0] = NaN;
  }

  // Re-renders when the camera moved, when 'force' says reflected objects moved, and every few
  // frames for flicker; otherwise the previous image is reused.
  update(scene, camera, force = false) {
    this.frame++;
    camera.updateMatrixWorld();
    const moved = !camera.matrixWorld.equals(this.lastCamera);
    if (!force && !moved && this.frame % 4 !== 0) return;
    this.lastCamera.copy(camera.matrixWorld);
    const {mirrorPos, cameraPos, rotation, normal, view, lookAt, target, plane, clip, q} = this.v;
    const virtual = this.camera;
    mirrorPos.setFromMatrixPosition(this.mirror.matrixWorld);
    cameraPos.setFromMatrixPosition(camera.matrixWorld);
    rotation.extractRotation(this.mirror.matrixWorld);
    normal.set(0, 0, 1).applyMatrix4(rotation);
    view.subVectors(mirrorPos, cameraPos);
    if (view.dot(normal) > 0) return; // camera below the board
    view.reflect(normal).negate().add(mirrorPos);
    rotation.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(cameraPos);
    target.subVectors(mirrorPos, lookAt).reflect(normal).negate().add(mirrorPos);
    virtual.position.copy(view);
    virtual.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    virtual.lookAt(target);
    virtual.far = camera.far;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    // World position -> reflection texture coordinates.
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);
    // Oblique near plane so nothing below the board leaks into the reflection.
    plane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(virtual.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = virtual.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + p[8]) / p[0];
    q.y = (Math.sign(clip.y) + p[9]) / p[5];
    q.z = -1;
    q.w = (1 + p[10]) / p[14];
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1 - 0.003; p[14] = clip.w;

    const renderer = this.renderer;
    const background = scene.background;
    const previousTarget = renderer.getRenderTarget();
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    const shadowsPending = renderer.shadowMap.needsUpdate;
    scene.background = null;
    renderer.shadowMap.needsUpdate = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, virtual);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.shadowMap.needsUpdate = shadowsPending;
    scene.background = background;
  }

  dispose() { this.target.dispose(); }
}

// Blends the mirror image into a MeshStandard/Physical material: Fresnel-weighted, slightly
// blurred, distorted by the surface's normal map, and only on upward-facing faces.
export function addPlanarReflection(material, reflection, {strength = 0.8, blur = 1.2} = {}) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uReflection = reflection.uniforms.uReflection;
    shader.uniforms.uReflectMatrix = reflection.uniforms.uReflectMatrix;
    shader.uniforms.uReflectStrength = {value: strength};
    shader.uniforms.uReflectBlur = {value: blur};
    shader.vertexShader = 'uniform mat4 uReflectMatrix;\nvarying vec4 vReflectCoord;\nvarying float vReflectUp;\n' +
      shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vReflectCoord = uReflectMatrix * modelMatrix * vec4(transformed, 1.0);
        vReflectUp = normalize(mat3(modelMatrix) * objectNormal).y;`);
    shader.fragmentShader = 'uniform sampler2D uReflection;\nuniform float uReflectStrength;\nuniform float uReflectBlur;\nvarying vec4 vReflectCoord;\nvarying float vReflectUp;\n' +
      shader.fragmentShader.replace('#include <opaque_fragment>', `{
          vec2 reflectUv = vReflectCoord.xy / vReflectCoord.w + (normal.xy - nonPerturbedNormal.xy) * 0.03;
          vec4 mirror = textureLod(uReflection, reflectUv, uReflectBlur);
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float fresnel = 0.16 + 0.84 * pow(1.0 - facing, 5.0);
          // Cleared texels are transparent black, so blurred edges are already premultiplied.
          outgoingLight += mirror.rgb * fresnel * uReflectStrength * smoothstep(0.6, 0.95, vReflectUp);
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'planar-reflection';
  material.needsUpdate = true;
}
