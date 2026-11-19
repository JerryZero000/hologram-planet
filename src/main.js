// 全息风格星球 — 第一课，只有一个视角。
// 屏幕上的发光是三维视觉效果，不是物理全息投影。
//
// 以后如果要做透明反射金字塔（佩珀尔幻象），不要重写星球。
// 扩展点就这几处：createCameras、syncCameras、layoutViewports、renderView。
// 四台相机绕竖直轴相差 90°，屏幕再分成四块。
// 画面在屏幕上还要不要旋转，取决于屏幕在金字塔上方还是下方。
// 屏幕尺寸还不知道，所以这里不写视口边长，也不做四画面。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 想改外观或手感，先改这几行。练习题也是改这里，保存后刷新即可。
const glowColor = 0x5eead4;
const spinSpeed = 0.18;
const minDistance = 2.25;
const maxDistance = 8.2;

let renderer = null;
let scene = null;
let cameras = [];
let controls = null;
let planetGroup = null;
let outerGlow = null;
let frameId = 0;
let spinning = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const drawSize = new THREE.Vector2();
const orbitSpherical = new THREE.Spherical();
const orbitOffset = new THREE.Vector3();
// Timer 负责算每一帧过了多少秒。旧的 Clock 在当前 three.js 里会打弃用警告。
const timer = new THREE.Timer();
timer.connect(document);

// ------------------------------------------------------------
// 页面：WebGL 不可用时留下说明，而不是一块黑屏。
// ------------------------------------------------------------

function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return Boolean(gl);
  } catch (error) {
    return false;
  }
}

function showFallback(message) {
  const fallback = document.querySelector('#fallback');
  const text = document.querySelector('#fallback-text');
  if (message) {
    text.textContent = message;
  }
  fallback.hidden = false;
  for (const selector of ['header', 'footer', '#scene', '.vignette', '.scanlines']) {
    const element = document.querySelector(selector);
    if (element) {
      element.hidden = true;
    }
  }
}

function updateSpinButton() {
  const button = document.querySelector('#toggle-spin');
  button.textContent = spinning ? '暂停自转' : '继续自转';
  button.setAttribute('aria-pressed', spinning ? 'false' : 'true');
}

// ------------------------------------------------------------
// 1. 场景、相机、渲染器
// 场景是舞台。相机是观看的位置。渲染器把舞台画进 canvas。
// 坐标：x 向右，y 向上，z 朝向屏幕外。原点在星球中心。
// ------------------------------------------------------------

function createRenderer(canvas) {
  const webglRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  webglRenderer.setSize(window.innerWidth, window.innerHeight);
  webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
  webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  webglRenderer.toneMappingExposure = 1.08;
  // 自己清屏再逐块画。以后四块视口如果每块都清屏，前一块会被擦掉。
  webglRenderer.autoClear = false;
  webglRenderer.setClearColor(0x000000, 0);

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancelAnimationFrame(frameId);
    showFallback('图形功能中断了，三维画面已停止。请刷新页面。');
  });

  return webglRenderer;
}

function framedDistance() {
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  if (aspect < 0.75) return 5.2;
  if (aspect < 1) return 4.35;
  return 3.62;
}

function homePosition() {
  // 主相机在星球前上方。重置视角会回到这里。
  return new THREE.Vector3(0.28, 0.46, framedDistance());
}

function createCameras() {
  const list = [];
  const main = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  main.position.copy(homePosition());
  list.push(main);

  // 以后加四视角：在这里再 push 三台 PerspectiveCamera。
  // 不要给它们写死坐标。syncCameras() 会抄主相机的距离和俯仰，
  // 只在水平角上加 90°、180°、270°，四面看的是同一颗星球。

  return list;
}

// ------------------------------------------------------------
// 2. 球体与材质
// 球体是程序生成的。表面贴图是画布上画出来的，不下载图片。
// ------------------------------------------------------------

function rand(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function clampByte(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function createSurfaceTexture() {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#01080c';
  ctx.fillRect(0, 0, width, height);

  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  shade.addColorStop(0.5, 'rgba(28, 96, 92, 0.2)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 16; i += 1) {
    const x = rand(i + 3) * width;
    const y = height * (0.14 + rand(i + 40) * 0.72);
    const rx = 34 + rand(i + 70) * 108;
    const ry = 22 + rand(i + 100) * 58;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand(i + 130) * Math.PI);
    const land = ctx.createRadialGradient(0, 0, rx * 0.05, 0, 0, rx);
    land.addColorStop(0, 'rgba(236, 255, 250, 0.96)');
    land.addColorStop(0.34, 'rgba(92, 220, 200, 0.92)');
    land.addColorStop(0.68, 'rgba(18, 120, 110, 0.55)');
    land.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = land;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < 5; i += 1) {
    const x = rand(i + 160) * width;
    const y = height * (0.22 + rand(i + 190) * 0.56);
    const rx = 50 + rand(i + 210) * 120;
    const sea = ctx.createRadialGradient(x, y, 0, x, y, rx);
    sea.addColorStop(0, 'rgba(1, 8, 12, 0.72)');
    sea.addColorStop(1, 'rgba(1, 8, 12, 0)');
    ctx.fillStyle = sea;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.62, rand(i + 240) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 16) {
    const grain = (rand(i + 17) - 0.5) * 16;
    data[i] = clampByte(data[i] + grain);
    data[i + 1] = clampByte(data[i + 1] + grain);
    data[i + 2] = clampByte(data[i + 2] + grain);
  }
  ctx.putImageData(pixels, 0, 0);

  ctx.strokeStyle = 'rgba(186, 255, 244, 0.4)';
  ctx.lineWidth = 1.4;
  const meridians = 12;
  const parallels = 8;
  for (let i = 0; i < meridians; i += 1) {
    const x = (i / meridians) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let j = 0; j <= parallels; j += 1) {
    const y = (j / parallels) * height;
    ctx.globalAlpha = j === 0 || j === parallels ? 0.25 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = 'rgba(230, 255, 250, 0.85)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  for (let i = 0; i < 26; i += 1) {
    const x = rand(i + 220) * width;
    const y = height * (0.22 + rand(i + 280) * 0.56);
    const spot = ctx.createRadialGradient(x, y, 0, x, y, 3.2);
    spot.addColorStop(0, 'rgba(245, 255, 252, 0.95)');
    spot.addColorStop(1, 'rgba(245, 255, 252, 0)');
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createRoundTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.35, 'rgba(255, 255, 255, 0.7)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createAtmosphereMaterial(power, alpha) {
  // 外壳不用图片。视线擦过边缘时更亮，正面几乎透明。
  // 这就是全息感的亮边，名字叫菲涅尔（fresnel）。
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(glowColor) },
      uPower: { value: power },
      uAlpha: { value: alpha },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uAlpha;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), uPower);
        gl_FragColor = vec4(uColor, fresnel * uAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: false,
  });
}

function createPlanet(webglRenderer) {
  const group = new THREE.Group();
  // 把接缝转到背面，刚打开时先不要看见贴图左右边接上的地方。
  group.rotation.y = 0.55;

  const surfaceTexture = createSurfaceTexture();
  surfaceTexture.anisotropy = webglRenderer.capabilities.getMaxAnisotropy();

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshPhongMaterial({
      map: surfaceTexture,
      color: 0xffffff,
      emissive: new THREE.Color(glowColor),
      emissiveMap: surfaceTexture,
      emissiveIntensity: 0.38,
      specular: new THREE.Color(0x6ecfc4),
      shininess: 28,
    }),
  );
  surface.renderOrder = 1;

  const innerGlow = new THREE.Mesh(
    new THREE.SphereGeometry(1.045, 48, 32),
    createAtmosphereMaterial(2.8, 0.95),
  );
  innerGlow.renderOrder = 3;

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 48, 32),
    createAtmosphereMaterial(1.65, 0.42),
  );
  halo.renderOrder = 4;

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.58, 0.011, 12, 180), ringMaterial);
  ring.rotation.x = Math.PI / 2.35;
  ring.renderOrder = 2;

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.82, 0.006, 12, 180),
    ringMaterial.clone(),
  );
  outerRing.material.opacity = 0.4;
  outerRing.rotation.x = ring.rotation.x;
  outerRing.renderOrder = 2;

  // 软光晕放在不透明星球后面，只有轮廓外的一圈露出来。
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createRoundTexture(),
      color: glowColor,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.scale.set(5.1, 5.1, 1);
  sprite.renderOrder = 0;

  group.add(sprite, surface, ring, outerRing, innerGlow, halo);
  scene.add(group);
  return { group, outerGlow: halo };
}

function createStars() {
  const count = 280;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 16 + rand(i + 5) * 26;
    const theta = rand(i + 400) * Math.PI * 2;
    const y = rand(i + 800) * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    positions[i * 3] = Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = y * radius * 0.7;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      map: createRoundTexture(),
      color: 0xe7fffb,
      size: 0.13,
      alphaTest: 0.35,
      transparent: false,
      depthWrite: true,
    }),
  );
  scene.add(stars);
}

// ------------------------------------------------------------
// 3. 光照与辉光
// 三盏灯照在星球表面上（MeshPhongMaterial 会响应灯光）。
// 亮边主要来自上面的外壳，不是来自灯。外壳在 createPlanet 里。
// ------------------------------------------------------------

function createLights() {
  const hemi = new THREE.HemisphereLight(0xd9fff6, 0x071216, 0.42);
  const key = new THREE.DirectionalLight(0xf7fffd, 1.15);
  key.position.set(4.5, 2.4, 3.6);
  const rim = new THREE.PointLight(glowColor, 6, 18, 2);
  rim.position.set(-4.2, 1.2, -3.4);
  scene.add(hemi, key, rim);
}

// ------------------------------------------------------------
// 4. 控制
// 拖动绕星球转，滚轮或双指改变距离。平移关掉，中心始终是星球。
// 暂停只停自转，不锁视角。重置只恢复机位，不倒转星球。
// ------------------------------------------------------------

function createControls(camera, dom) {
  const orbit = new OrbitControls(camera, dom);
  orbit.target.set(0, 0, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.enablePan = false;
  orbit.rotateSpeed = 0.72;
  orbit.zoomSpeed = 0.65;
  orbit.minDistance = minDistance;
  orbit.maxDistance = maxDistance;
  orbit.minPolarAngle = 0.32;
  orbit.maxPolarAngle = Math.PI - 0.32;
  orbit.autoRotate = false;
  // 一根手指旋转。两根手指缩放（enablePan 已关，不会把星球拖走）。
  orbit.touches.ONE = THREE.TOUCH.ROTATE;
  orbit.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  orbit.update();
  orbit.saveState();
  return orbit;
}

function bindControlsUI() {
  updateSpinButton();
  document.querySelector('#toggle-spin').addEventListener('click', () => {
    spinning = !spinning;
    updateSpinButton();
  });
  document.querySelector('#reset-view').addEventListener('click', () => {
    controls.reset();
  });
}

// ------------------------------------------------------------
// 渲染一块画面。现在整屏调用一次。
// 以后金字塔每一面调用一次，并传入那一面的视口矩形。
// 相机朝向（看到星球的哪一侧）和画面在屏幕上的旋转是两件事。
// 反射会把画面临时翻一下，转多少要等屏幕放在金字塔哪一侧再定。
// ------------------------------------------------------------

function syncCameras() {
  const main = cameras[0];
  orbitOffset.copy(main.position).sub(controls.target);
  orbitSpherical.setFromVector3(orbitOffset);
  const baseTheta = orbitSpherical.theta;
  // 右、后、左。第 0 台是主相机，由 OrbitControls 直接驱动。
  const extraYaw = [Math.PI / 2, Math.PI, Math.PI * 1.5];
  for (let i = 1; i < cameras.length; i += 1) {
    orbitSpherical.theta = baseTheta + (extraYaw[i - 1] || 0);
    orbitOffset.setFromSpherical(orbitSpherical);
    cameras[i].position.copy(controls.target).add(orbitOffset);
    cameras[i].lookAt(controls.target);
  }
}

function layoutViewports(width, height) {
  // 单视角：一整块屏幕。宽高是绘图缓冲里的像素，不是 CSS 像素。
  // 四视角时改成四块不重叠的矩形，顺序和 cameras 一致。
  // 不要在这里猜边距——屏幕多大还不知道。
  return [{ camera: cameras[0], x: 0, y: 0, width, height }];
}

function renderView(camera, viewport) {
  renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
  if (renderer.getScissorTest()) {
    renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
  }
  const aspect = viewport.width / Math.max(viewport.height, 1);
  if (Math.abs(camera.aspect - aspect) > 0.0001) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
}

function renderFrame() {
  renderer.getDrawingBufferSize(drawSize);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, drawSize.x, drawSize.y);
  renderer.clear();
  const slots = layoutViewports(drawSize.x, drawSize.y);
  renderer.setScissorTest(slots.length > 1);
  for (const slot of slots) {
    renderView(slot.camera, slot);
  }
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ------------------------------------------------------------
// 5. 动画
// 每一帧转过的角度 = 速度 × 这一帧的秒数，所以不跟刷新率绑死。
// ------------------------------------------------------------

function animate() {
  frameId = requestAnimationFrame(animate);
  timer.update();
  const delta = Math.min(timer.getDelta(), 0.05);
  const elapsed = timer.getElapsed();
  if (spinning) {
    planetGroup.rotation.y += spinSpeed * delta;
  }
  if (outerGlow) {
    outerGlow.material.uniforms.uAlpha.value = 0.28 + Math.sin(elapsed * 1.35) * 0.06;
  }
  controls.update();
  syncCameras();
  renderFrame();
}

function init() {
  const canvas = document.querySelector('#scene');
  renderer = createRenderer(canvas);
  scene = new THREE.Scene();
  cameras = createCameras();
  createLights();
  createStars();
  const planet = createPlanet(renderer);
  planetGroup = planet.group;
  outerGlow = planet.outerGlow;
  controls = createControls(cameras[0], canvas);
  bindControlsUI();
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);
  animate();
}

function boot() {
  if (!detectWebGL()) {
    showFallback();
    return;
  }
  try {
    init();
  } catch (error) {
    console.error(error);
    showFallback('三维画面初始化失败。请刷新页面再试一次。');
  }
}

// 改完代码整页刷新，避免上一次的动画循环还在跑。
if (window.__hologramPlanetStarted) {
  window.location.reload();
} else {
  window.__hologramPlanetStarted = true;
  boot();
}

