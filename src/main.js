// 全息风格星球。
// 屏幕上的发光是三维视觉效果，不是物理全息投影。
// 四面预览给「屏幕朝上、金字塔放在屏幕上」的佩珀尔幻象用。
// 星球、灯光、辉光不要为了四面重写。改相机和视口即可。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 想改外观或手感，先改这几行。练习题也是改这里，保存后刷新即可。
const glowColor = 0x5eead4;
const spinSpeed = 0.18;
const minDistance = 2.25;
const maxDistance = 8.2;

// 四面预览。顺序：下、右、上、左，和 cameras 的顺序一致。
// yawOffset：绕竖直轴，相对主相机再转多少。四面看的是同一姿态，不是四颗各自转的星球。
// rollDegrees：这块画面在屏幕上的旋转（正数 = 逆时针）。它不改变你看到星球的哪一侧。
// 这组角度按「屏幕在金字塔下面」：每块的上方朝向屏幕中心，反射后侧面看才正。
// 如果改成屏幕在金字塔上方，把每个 rollDegrees 改成相反数（90 和 -90 对调，0 和 180 不用改）。
const PYRAMID_VIEWS = [
  { name: 'bottom', yawOffset: 0, rollDegrees: 0, col: 1, row: 0 },
  { name: 'right', yawOffset: Math.PI / 2, rollDegrees: 90, col: 2, row: 1 },
  { name: 'top', yawOffset: Math.PI, rollDegrees: 180, col: 1, row: 2 },
  { name: 'left', yawOffset: Math.PI * 1.5, rollDegrees: -90, col: 0, row: 1 },
];

const VIEW_MODE_KEY = 'hologram-view-mode';

let renderer = null;
let scene = null;
let cameras = [];
let controls = null;
let planetGroup = null;
let outerGlow = null;
let frameId = 0;
let spinning = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let viewMode = loadViewMode();

const drawSize = new THREE.Vector2();
const orbitSpherical = new THREE.Spherical();
const orbitOffset = new THREE.Vector3();
const rollAxis = new THREE.Vector3();
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

function loadViewMode() {
  try {
    const saved = sessionStorage.getItem(VIEW_MODE_KEY);
    if (saved === 'single' || saved === 'quad') return saved;
  } catch (error) {
    // 有的浏览器会禁掉 sessionStorage。用默认的四面预览即可。
  }
  return 'quad';
}

function updateChromePlacement() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const side = Math.floor(Math.min(width, height) / 3);
  const originX = Math.floor((width - side * 3) / 2);
  const originY = Math.floor((height - side * 3) / 2);
  const root = document.documentElement;
  root.style.setProperty('--cross-side', `${side}px`);
  root.style.setProperty('--cross-x', `${originX}px`);
  root.style.setProperty('--cross-y', `${originY}px`);
  document.body.classList.remove('chrome-outside-y', 'chrome-outside-x', 'chrome-corners');
  if (viewMode !== 'quad') return;
  // 字和按钮只放在十字外面的空处，不压住四块画面。
  if (originY >= 150) document.body.classList.add('chrome-outside-y');
  else if (originX >= 180) document.body.classList.add('chrome-outside-x');
  else document.body.classList.add('chrome-corners');
}

function applyViewMode(mode) {
  viewMode = mode;
  document.body.classList.toggle('mode-quad', mode === 'quad');
  document.body.classList.toggle('mode-single', mode === 'single');
  document.querySelector('#mode-single').setAttribute('aria-pressed', mode === 'single' ? 'true' : 'false');
  document.querySelector('#mode-quad').setAttribute('aria-pressed', mode === 'quad' ? 'true' : 'false');
  document.querySelector('.kicker').textContent = mode === 'quad' ? '四面预览 · 屏幕在下' : '单视角';
  document.querySelector('.hint').textContent = mode === 'quad'
    ? '四面一起转 · 滚轮或双指缩放'
    : '拖动旋转视角 · 滚轮或双指缩放';
  try {
    sessionStorage.setItem(VIEW_MODE_KEY, mode);
  } catch (error) {
    // 记不住就下次还用默认。不影响画面。
  }
  updateChromePlacement();
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
  // 自己清一次屏，再逐块画。四块视口如果每块都清屏，前一块会被擦掉。
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
  const home = homePosition();
  return PYRAMID_VIEWS.map(() => {
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    // 先都放在主相机的家里。真正的方位由 syncCameras() 每帧抄过去。
    camera.position.copy(home);
    camera.lookAt(0, 0, 0);
    return camera;
  });
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
  applyViewMode(viewMode);
  document.querySelector('#toggle-spin').addEventListener('click', () => {
    spinning = !spinning;
    updateSpinButton();
  });
  document.querySelector('#reset-view').addEventListener('click', () => {
    controls.reset();
  });
  document.querySelector('#mode-single').addEventListener('click', () => {
    applyViewMode('single');
  });
  document.querySelector('#mode-quad').addEventListener('click', () => {
    applyViewMode('quad');
  });
}

// ------------------------------------------------------------
// 渲染。单视角画一整屏；四面预览把同一姿态画进十字的四块。
// 相机朝向（yawOffset）和画面在屏幕上的旋转（rollDegrees）是两件事。
// ------------------------------------------------------------

function applyViewportRoll(camera, degrees) {
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  if (!degrees) return;
  // 绕「从相机指向星球」的轴转 up。转完，画面在这块矩形里跟着转，星球的侧面不变。
  rollAxis.copy(controls.target).sub(camera.position);
  if (rollAxis.lengthSq() < 1e-8) return;
  rollAxis.normalize();
  camera.up.applyAxisAngle(rollAxis, THREE.MathUtils.degToRad(degrees));
  camera.lookAt(controls.target);
}

function syncCameras() {
  // 主相机的位置就是当前轨道。距离和俯仰原样抄给另外三台，只加水平角。
  // 不改 cameras[0].up：OrbitControls 每帧会用它来 lookAt，改了轨道会歪。
  const main = cameras[0];
  orbitOffset.copy(main.position).sub(controls.target);
  orbitSpherical.setFromVector3(orbitOffset);
  const baseTheta = orbitSpherical.theta;
  const basePhi = orbitSpherical.phi;
  const baseRadius = orbitSpherical.radius;

  for (let i = 1; i < cameras.length; i += 1) {
    const view = PYRAMID_VIEWS[i];
    orbitSpherical.theta = baseTheta + view.yawOffset;
    orbitSpherical.phi = basePhi;
    orbitSpherical.radius = baseRadius;
    orbitOffset.setFromSpherical(orbitSpherical);
    const camera = cameras[i];
    camera.position.copy(controls.target).add(orbitOffset);
    applyViewportRoll(camera, view.rollDegrees);
  }
}

function layoutViewports(width, height) {
  // 宽高是绘图缓冲里的像素，不是 CSS 像素，也不是金字塔的实物边长。
  if (viewMode !== 'quad') {
    return [{ camera: cameras[0], x: 0, y: 0, width, height }];
  }

  const side = Math.max(1, Math.floor(Math.min(width, height) / 3));
  const originX = Math.floor((width - side * 3) / 2);
  const originY = Math.floor((height - side * 3) / 2);
  // 十字：上、下、左、右各一块正方形，中间和四角留空。row 从屏幕底部数。
  return PYRAMID_VIEWS.map((view, index) => ({
    camera: cameras[index],
    x: originX + view.col * side,
    y: originY + view.row * side,
    width: side,
    height: side,
  }));
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
  updateChromePlacement();
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
