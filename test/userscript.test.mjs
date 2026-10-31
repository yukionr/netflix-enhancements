import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = () => readFileSync(new URL('../src/script.user.js', import.meta.url), 'utf8');
function load(overrides = {}) {
    const sandbox = { module: { exports: {} }, ...overrides };
    vm.runInNewContext(source(), sandbox);
    return sandbox.module.exports;
}
const rect = (width, height, left = 0, top = 0) => ({ width, height, left, top });

test('fills only side margins and removes contained black bars from the mirrored background', () => {
    const { layout } = load();
    const result = layout(rect(2560, 1080), rect(2560, 1080), 1920, 1080, 'contain');
    assert.equal(result.left, 320);
    assert.equal(result.right, 2240);
    assert.equal(result.width, 2560);
    assert.equal(result.height, 1080);
    assert.ok(Math.abs(result.backgroundWidth - 2560 * 4 / 3) < 0.001);
    assert.equal(result.backgroundHeight, 1440);
});

test('handles a content-sized video, offset player, and display resize', () => {
    const { layout } = load();
    const result = layout(rect(2560, 1080, 10, 20), rect(1920, 1080, 330, 20), 1920, 1080, 'contain');
    assert.equal(result.left, 320);
    assert.equal(result.right, 2240);
    assert.equal(result.backgroundWidth, 2560);
    assert.equal(result.backgroundHeight, 1440);
    assert.equal(layout(rect(1920, 1080), rect(1920, 1080), 1920, 1080, 'contain'), null);
    assert.equal(layout(rect(1080, 1920), rect(1080, 1920), 1920, 1080, 'contain'), null);
});

test('does not paint over cropped, stretched, unready, or hidden video', () => {
    const { layout } = load();
    for (const fit of ['cover', 'fill']) {
        assert.equal(layout(rect(2560, 1080), rect(2560, 1080), 1920, 1080, fit), null);
    }
    assert.equal(layout(rect(2560, 1080), rect(2560, 1080), 0, 0, 'contain'), null);
    assert.equal(layout(rect(0, 0), rect(0, 0), 1920, 1080, 'contain'), null);
});

function fixture({ firefox = true, blocked = false, frameCallbacks = true, stored = {} } = {}) {
    const listeners = new Map();
    const menus = [];
    const images = [];
    const warnings = [];
    const prompts = [];
    const logs = [];
    const draws = [];
    const timers = new Map();
    const frames = new Map();
    const saved = [];
    const alerts = [];
    let answer = null;
    let nextFrame = 0;
    let nextTimer = 0;
    let observer;
    let videos = [];
    const controls = [];
    function element(tag) {
        const node = {
            tagName: tag.toUpperCase(), style: {}, children: [], isConnected: true,
            getAttribute(name) { return this[name] ?? null; },
            setAttribute(name, value) { this[name] = value; },
            append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } },
            prepend(child) { child.parentElement = this; this.children.unshift(child); },
            remove() { this.isConnected = false; this.parentElement.children = this.parentElement.children.filter((x) => x !== this); },
            attachShadow() { this.shadowRoot = element('shadow-root'); return this.shadowRoot; },
            showPopover() { this.open = true; },
            getBoundingClientRect() { return this.rect || rect(2560, 1080); },
            getClientRects() { return [this.getBoundingClientRect()]; },
            contains(other) { return other === this || this.children.some((child) => child.contains(other)); },
            getContext() { return {
                drawImage(...args) { if (blocked) throw new Error('Protected media'); if (node.width !== 16) draws.push(args); },
                getImageData() { return { data: new Uint8ClampedArray([120, 80, 40, 255]) }; }
            }; }
        };
        return node;
    }
    const player = element('div');
    const video = element('video');
    Object.assign(video, { videoWidth: 1920, videoHeight: 1080, readyState: 4, paused: false,
        currentTime: 1, ended: false, closest: (selector) => selector.includes('data-uia') ? null : player });
    if (frameCallbacks) {
        video.requestVideoFrameCallback = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
        video.cancelVideoFrameCallback = (id) => frames.delete(id);
    }
    player.append(video);
    videos = [video];
    const document = {
        documentElement: element('html'), hidden: false, fullscreenElement: null,
        title: 'Netflix', querySelector: () => null,
        querySelectorAll: (selector) => selector === 'video' ? videos : selector.includes('controls-container') ? controls : document.documentElement.children.filter((node) => node['data-netflix-blurred-bars'] !== undefined),
        createElement: element,
        addEventListener: (type, callback) => listeners.set(type, callback),
        ...(firefox ? { mozSetImageElement: (id, value) => images.push([id, value]) } : {})
    };
    document.documentElement.append(player);
    const sandbox = {
        document, window: { addEventListener: (type, callback) => listeners.set(type, callback) }, location: { pathname: '/watch/123' },
        CSS: { supports: () => firefox },
        getComputedStyle: (node) => ({ objectFit: 'contain', objectPosition: '50% 50%', display: 'block', visibility: 'visible', opacity: '1', ...node.style }),
        MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
        setInterval: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
        clearInterval: (id) => timers.delete(id),
        GM_registerMenuCommand: (label, callback) => menus.push({ label, callback }),
        GM_getValue: () => stored,
        GM_setValue: (key, value) => saved.push({ key, value: JSON.parse(JSON.stringify(value)) }),
        performance: { now: () => 1000 },
        alert: (message) => alerts.push(message),
        GM_log: (value) => { if (JSON.parse(value).event !== 'started') logs.push(value); },
        prompt: (label, value) => { prompts.push(value); return answer; },
        console: { warn: (message) => warnings.push(message) }
    };
    load(sandbox);
    const tick = () => [...timers.values()].forEach((callback) => callback());
    return { controls, element, saved, alerts, answer: (value) => { answer = value; }, frames, presentFrame: () => { const [id, callback] = [...frames][0]; frames.delete(id); callback(); }, logs, prompts, host: document.documentElement, player, video, document, images, menus, warnings, draws, timers, tick, listeners,
        mutate: () => observer(), navigate: (pathname) => { sandbox.location.pathname = pathname; },
        replaceVideo: () => {
            const replacement = element('video');
            Object.assign(replacement, video);
            replacement.children = [];
            video.isConnected = false;
            player.children = player.children.filter((child) => child !== video);
            player.append(replacement);
            videos = [replacement];
            return replacement;
        } };
}

test('Firefox mirrors the video without a pixel copy or changing its id, style, or playback', () => {
    const f = fixture();
    f.tick();
    assert.equal(f.host.children.length, 2);
    assert.equal(f.images.at(-1)[1], f.video.parentElement);
    assert.equal(f.draws.length, 0);
    assert.equal(f.video.id, undefined);
    assert.deepEqual(f.video.style, {});
    assert.equal(f.video.paused, false);
    const overlay = f.host.children[0];
    assert.equal(overlay.style.pointerEvents, 'none');
    assert.equal(overlay['aria-hidden'], 'true');
    assert.equal(overlay.shadowRoot.children.length, 3);
    assert.equal(overlay.shadowRoot.children[0].style.width, '320px');
    assert.equal(overlay.shadowRoot.children[1].style.left, '2240px');
    assert.match(overlay.shadowRoot.children[0].children[0].style.backgroundImage, /-moz-element/);
});

test('cleans up on navigation, hidden tabs, toggle, and video replacement; resumes without duplicates', () => {
    const f = fixture();
    f.tick();
    f.document.hidden = true;
    f.tick();
    assert.equal(f.host.children.length, 1);
    assert.equal(f.images.at(-1)[1], null);
    f.document.hidden = false;
    f.tick();
    assert.equal(f.host.children.length, 2);
    const replacement = f.replaceVideo();
    f.mutate();
    f.tick();
    assert.equal(f.host.children.length, 2);
    assert.equal(f.images.at(-1)[1], replacement.parentElement);
    f.menus.find(({ label }) => label === 'Turn Netflix background OFF').callback();
    assert.equal(f.host.children.length, 1);
    f.tick();
    assert.equal(f.host.children.length, 1);
    f.menus.find(({ label }) => label === 'Turn Netflix background ON').callback();
    f.tick();
    assert.equal(f.host.children.length, 2);
    f.navigate('/browse');
    f.tick();
    assert.equal(f.host.children.length, 1);
});

test('uses small Canvas copies outside Firefox and stops on protected-frame errors', () => {
    const f = fixture({ firefox: false });
    assert.equal(f.draws.length, 2);
    assert.ok(f.draws[0][7] <= 320);
    f.video.paused = true;
    assert.equal(f.draws.length, 2);
    f.video.currentTime = 20;
    f.tick();
    assert.equal(f.draws.length, 4);
    const denied = fixture({ firefox: false, blocked: true });
    denied.tick();
    assert.equal(denied.host.children.length, 1);
    assert.equal(denied.warnings.length, 1);
    denied.tick();
    assert.equal(denied.warnings.length, 1);
    assert.equal(denied.video.paused, false);
});

test('resize, fullscreen, and page exit remove or refresh the overlay', () => {
    const f = fixture();
    f.tick();
    f.player.rect = rect(1920, 1080);
    f.video.rect = rect(1920, 1080);
    f.tick();
    assert.equal(f.host.children.length, 1);
    delete f.player.rect;
    delete f.video.rect;
    f.document.fullscreenElement = f.player;
    f.listeners.get('fullscreenchange')();
    f.tick();
    assert.equal(f.host.children.length, 2);
    f.listeners.get('pagehide')();
    assert.equal(f.host.children.length, 1);
    assert.equal(f.timers.size, 0);
});

test('redraws paused Canvas backgrounds after resizing and resumes after page restoration', () => {
    const f = fixture({ firefox: false });
    f.video.paused = true;
    f.player.rect = rect(2880, 1080);
    f.video.rect = rect(2880, 1080);
    f.tick();
    assert.equal(f.draws.length, 4);
    f.listeners.get('pagehide')();
    assert.equal(f.timers.size, 0);
    f.listeners.get('pageshow')();
    assert.equal(f.timers.size, 1);
    assert.equal(f.host.children.length, 2);
});

test('isolates background panels from page styles and positions them outside transformed ancestors', () => {
    const f = fixture();
    const overlay = f.document.documentElement.children[0];
    assert.equal(overlay['data-netflix-blurred-bars'], '');
    assert.equal(overlay.popover, 'manual');
    assert.equal(overlay.open, true);
    assert.ok(overlay.shadowRoot);
    assert.equal(f.player.children.length, 1);
    f.player.rect = rect(1920, 810, 80, 40);
    f.video.rect = rect(1920, 810, 80, 40);
    f.tick();
    assert.equal(overlay.style.left, '80px');
    assert.equal(overlay.style.top, '40px');
    assert.equal(overlay.style.width, '1920px');
    assert.equal(overlay.style.height, '810px');
    assert.equal(overlay.shadowRoot.children[0].style.width, '240px');
    assert.equal(overlay.shadowRoot.children[1].style.left, '1680px');
});

test('diagnostics identify the running version, renderer and measured layout without page content', () => {
    const f = fixture();
    const menu = f.menus.find(({ label }) => label.includes('diagnostics'));
    assert.ok(menu, 'a versioned diagnostic menu is available');
    menu.callback();
    const report = JSON.parse(f.prompts[0]);
    assert.equal(report.version, '1.2.0');
    assert.equal(report.renderer, 'firefox-css');
    assert.equal(report.status, 'active');
    assert.equal(report.overlays.length, 1);
    assert.equal(report.overlays[0].version, '1.2.0');
    assert.equal(report.videos[0].source.width, 1920);
    assert.equal(report.videos[0].rect.width, 2560);
    assert.equal(report.videos[0].player.rect.width, 2560);
    assert.equal(report.videos[0].objectFit, 'contain');
    assert.equal(report.videos[0].canvas, null);
    assert.ok(!f.prompts[0].includes('/watch/123'));
    assert.ok(!f.prompts[0].includes('currentTime'));
    f.player.rect = rect(1920, 1080);
    f.video.rect = rect(1920, 1080);
    f.tick();
    menu.callback();
    assert.equal(JSON.parse(f.prompts[1]).status, 'no-supported-side-margins');
});

test('logs measured geometry and frame-copy support once per layout for granted-tab debugging', () => {
    const f = fixture();
    assert.equal(f.logs.length, 1);
    const report = JSON.parse(f.logs[0]);
    assert.equal(report.version, '1.2.0');
    assert.equal(report.renderer, 'firefox-css');
    assert.equal(report.frameCopy, 'available');
    assert.equal(report.overlays[0].panels.length, 2);
    f.tick();
    assert.equal(f.logs.length, 1);
    f.player.rect = rect(2880, 1080);
    f.video.rect = rect(2880, 1080);
    f.tick();
    assert.equal(f.logs.length, 2);
    assert.ok(!f.logs[0].includes('/watch/123'));
    const blocked = fixture({ blocked: true });
    assert.equal(JSON.parse(blocked.logs[0]).frameCopy, 'blocked');
    assert.equal(blocked.host.children.length, 2);
});

test('logs why no background is drawn when Netflix changes to an unsupported layout', () => {
    const f = fixture();
    f.player.rect = rect(1920, 1080);
    f.video.rect = rect(1920, 1080);
    f.tick();
    assert.equal(JSON.parse(f.logs.at(-1)).status, 'no-supported-side-margins');
    assert.equal(JSON.parse(f.logs.at(-1)).overlays.length, 0);
    const count = f.logs.length;
    f.tick();
    assert.equal(f.logs.length, count);
});

test('mirrors the painted video container and keeps both filtered surfaces within the side margins', () => {
    const f = fixture();
    const root = f.host.children[0];
    assert.equal(f.images.at(-1)[1], f.video.parentElement);
    const [left, right] = root.shadowRoot.children;
    assert.equal(left.children[0].style.width, '320px');
    assert.equal(right.children[0].style.width, '320px');
    assert.equal(left.children[0].style.left, '0px');
    assert.equal(right.children[0].style.left, '0px');
    const position = (panel) => panel.children[0].style.backgroundPosition.split(' ').map(parseFloat);
    assert.equal(position(left)[0] - position(right)[0], 2240);
});

test('sizes the mirror using the painted container when the video itself has a smaller box', () => {
    const { layout } = load();
    const geometry = layout(rect(2560, 1080), rect(1920, 1080, 320), 1920, 1080, 'contain', rect(2560, 1080));
    assert.ok(Math.abs(geometry.backgroundWidth - 2560 * 4 / 3) < 0.001);
    assert.equal(geometry.backgroundHeight, 1440);
});

test('refreshes the painted mirror on each presented video frame and cancels callbacks on cleanup', () => {
    const f = fixture();
    assert.equal(f.frames.size, 1);
    const before = f.images.length;
    f.presentFrame();
    assert.equal(f.images.length, before + 2);
    assert.equal(f.images.at(-2)[1], null);
    assert.equal(f.images.at(-1)[1], f.video.parentElement);
    assert.equal(f.frames.size, 1);
    f.presentFrame();
    f.menus.find(({ label }) => label.includes('diagnostics')).callback();
    const report = JSON.parse(f.prompts[0]);
    assert.equal(report.frameSync, 'video-frame-callback');
    assert.equal(report.refreshedFrames, 2);
    const late = [...f.frames.values()][0];
    f.menus.find(({ label }) => label === 'Turn Netflix background OFF').callback();
    assert.equal(f.frames.size, 0);
    const after = f.images.length;
    late();
    assert.equal(f.images.length, after);
    assert.equal(f.frames.size, 0);
});

test('keeps automatic CSS updates when the frame callback API is unavailable', () => {
    const f = fixture({ frameCallbacks: false });
    assert.equal(f.frames.size, 0);
    assert.equal(f.host.children.length, 2);
    f.menus.find(({ label }) => label.includes('diagnostics')).callback();
    assert.equal(JSON.parse(f.prompts[0]).frameSync, 'automatic');
});

test('loads persisted settings and applies saved feature switches immediately', () => {
    const f = fixture({ stored: { blurredBars: false, volumeWheel: false } });
    assert.equal(f.host.children.length, 1);
    const menu = f.menus.find(({ label }) => label === 'Netflix Enhancements settings');
    f.answer(JSON.stringify({ blurredBars: true, keyboard: false }));
    menu.callback();
    assert.equal(f.host.children.length, 2);
    assert.equal(f.saved.at(-1).key, 'settings');
    assert.equal(f.saved.at(-1).value.blurredBars, true);
    assert.equal(f.saved.at(-1).value.keyboard, false);
    assert.equal(f.saved.at(-1).value.volumeWheel, false);
    f.menus.find(({ label }) => label === 'Turn Netflix background OFF').callback();
    assert.equal(f.saved.at(-1).value.blurredBars, false);
    assert.equal(f.host.children.length, 1);
});

test('canceled or invalid settings leave current features and storage unchanged', () => {
    const f = fixture();
    const menu = f.menus.find(({ label }) => label === 'Netflix Enhancements settings');
    for (const answer of [null, '{', 'null', '[]', '{"blurredBars":"false"}', '{"unknown":true}']) {
        f.answer(answer);
        menu.callback();
        assert.equal(f.host.children.length, 2);
        assert.equal(f.saved.length, 0);
    }
    assert.equal(f.alerts.length, 5);
});

test('keeps update identity and exposes only the required storage and menu APIs', () => {
    const header = source().split('// ==/UserScript==')[0];
    assert.match(header, /@name\s+Netflix Enhancements\n/);
    assert.match(header, /@namespace\s+local.netflix-blurred-bars\n/);
    assert.match(header, /@version\s+1\.2\.0\n/);
    assert.match(header, /@match\s+https:\/\/www\.netflix\.com\/\*\n/);
    assert.deepEqual([...header.matchAll(/@grant\s+(\S+)/g)].map((match) => match[1]).sort(),
        ['GM_getValue', 'GM_log', 'GM_registerMenuCommand', 'GM_setValue']);
});

test('hides the top-layer blur while controls are visible and restores it after they fade', () => {
    const f = fixture();
    const overlay = f.host.children[0];
    const bar = f.element('div');
    f.player.append(bar);
    f.controls.push(bar);
    f.mutate();
    assert.equal(overlay.style.visibility, 'hidden');
    bar.style.opacity = '0';
    f.mutate();
    assert.equal(overlay.style.visibility, 'visible');
    delete bar.style.opacity;
    f.tick();
    assert.equal(overlay.style.visibility, 'hidden');
    bar.style.display = 'none';
    f.mutate();
    assert.equal(overlay.style.visibility, 'visible');
    delete bar.style.display;
    f.player.style.opacity = '0';
    f.mutate();
    assert.equal(overlay.style.visibility, 'visible');
    f.player.style.opacity = '1';
    f.mutate();
    assert.equal(overlay.style.visibility, 'hidden');
    assert.equal(f.frames.size, 1, 'hiding preserves the frame callback and mirror');
});

test('explicit ON and OFF menu commands persist state and are safe to repeat', () => {
    const f = fixture();
    const on = f.menus.find(({ label }) => label === 'Turn Netflix background ON');
    const off = f.menus.find(({ label }) => label === 'Turn Netflix background OFF');
    assert.ok(on);
    assert.ok(off);
    off.callback();
    off.callback();
    assert.equal(f.host.children.length, 1);
    assert.equal(f.saved.at(-1).value.blurredBars, false);
    assert.equal(f.frames.size, 0);
    on.callback();
    on.callback();
    assert.equal(f.host.children.length, 2);
    assert.equal(f.saved.at(-1).value.blurredBars, true);
    assert.equal(f.frames.size, 1);
    const restored = fixture({ stored: f.saved.at(-1).value });
    assert.equal(restored.host.children.length, 2);
});
