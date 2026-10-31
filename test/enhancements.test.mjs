import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/script.user.js', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source, sandbox);

function fixture() {
    const listeners = new Map();
    const settings = { zoom: true, ultrawide: true, keyboard: true, volumeWheel: true, statistics: false, tabTitle: true };
    let now = 0;
    let frames = 100;
    let current;
    const player = { append(node) { node.isConnected = true; }, contains(node) { return node === current; } };
    const style = () => {
        const values = new Map();
        return {
            setProperty(key, value, priority = '') { values.set(key, [value, priority]); },
            getPropertyValue(key) { return values.get(key)?.[0] || ''; },
            getPropertyPriority(key) { return values.get(key)?.[1] || ''; },
            removeProperty(key) { values.delete(key); }
        };
    };
    const makeVideo = () => ({
        style: style(), isConnected: true, readyState: 4, ended: false,
        videoWidth: 1920, videoHeight: 1080, volume: 0.5, muted: true,
        closest: (selector) => selector.startsWith('.watch-video') ? player : null, parentElement: player,
        getBoundingClientRect: () => ({ width: 2560, height: 1080 }),
        getVideoPlaybackQuality: () => ({ totalVideoFrames: frames, droppedVideoFrames: 2 })
    });
    current = makeVideo();
    const nodes = [];
    const title = { childNodes: [{ textContent: 'Example series' }, { textContent: ' Episode 2' }] };
    const document = {
        title: 'Netflix', hidden: false,
        querySelectorAll: () => current ? [current] : [],
        querySelector: () => title,
        createElement() {
            const node = { style: {}, setAttribute() {}, remove() { this.isConnected = false; } };
            nodes.push(node);
            return node;
        },
        addEventListener: (name, callback) => listeners.set(name, callback)
    };
    const location = { pathname: '/watch/123' };
    const changes = [];
    const controller = sandbox.module.exports.createEnhancements({
        document, location, settings,
        getComputedStyle: (node) => ({ display: 'block', visibility: 'visible', opacity: '1', transform: node.style.getPropertyValue('transform') || 'none' }),
        now: () => now,
        save: () => changes.push({ ...settings }), alert() {}
    });
    controller.update();
    function event(properties = {}) {
        return { target: current, key: '', prevented: false, preventDefault() { this.prevented = true; }, ...properties };
    }
    return {
        controller, settings, document, location, nodes, changes, title,
        get video() { return current; },
        key(key, properties) { const e = event({ key, ...properties }); listeners.get('keydown')(e); return e; },
        wheel(properties) { const e = event({ deltaY: -100, ...properties }); listeners.get('wheel')(e); return e; },
        advance(ms, count) { now += ms; frames += count; controller.update(); },
        replace() { current.isConnected = false; current = makeVideo(); controller.update(); }
    };
}

test('zoom follows Netflix positioning transforms and restores inline transform and scale on reset', () => {
    const f = fixture();
    f.video.style.setProperty('transform', 'translateX(-50%)');
    f.video.style.setProperty('scale', '0.9', 'important');
    f.key('.');
    assert.match(f.video.style.getPropertyValue('transform'), /scale\(1\.3125\)$/);
    assert.equal(f.video.style.getPropertyValue('scale'), '0.9');
    assert.match(f.video.style.getPropertyValue('transform'), /^translateX\(-50%\) scale\(/);
    f.key('+');
    assert.match(f.video.style.getPropertyValue('transform'), /scale\(1\.3625\)$/);
    f.key('-');
    assert.match(f.video.style.getPropertyValue('transform'), /scale\(1\.3125\)$/);
    f.advance(1000, 24);
    assert.equal(f.video.style.getPropertyValue('transform'), 'translateX(-50%) scale(1.3125)');
    f.key(',');
    assert.equal(f.video.style.getPropertyValue('scale'), '0.9');
    assert.equal(f.video.style.getPropertyPriority('scale'), 'important');
    assert.equal(f.video.style.getPropertyValue('transform'), 'translateX(-50%)');
});

test('typing, composition, shortcuts with modifiers and non-player pages remain untouched', () => {
    const f = fixture();
    for (const properties of [
        { target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } },
        { target: { isContentEditable: true } }, { isComposing: true }, { keyCode: 229 },
        { ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }
    ]) assert.equal(f.key('+', properties).prevented, false);
    f.settings.keyboard = false;
    assert.equal(f.key('+').prevented, false);
    f.settings.keyboard = true;
    f.location.pathname = '/browse';
    assert.equal(f.key('+').prevented, false);
    assert.equal(f.wheel().prevented, false);
});

test('wheel controls only player volume, clamps it, and unmutes only on increase', () => {
    const f = fixture();
    assert.equal(f.wheel().prevented, true);
    assert.equal(f.video.volume, 0.55);
    assert.equal(f.video.muted, false);
    f.video.volume = 0.99;
    f.wheel();
    assert.equal(f.video.volume, 1);
    f.video.volume = 0.01;
    f.video.muted = true;
    f.wheel({ deltaY: 100 });
    assert.equal(f.video.volume, 0);
    assert.equal(f.video.muted, true);
    for (const properties of [{ deltaY: 0 }, { ctrlKey: true }, { target: {} }, { target: { tagName: 'INPUT' } }]) {
        assert.equal(f.wheel(properties).prevented, false);
    }
    f.settings.volumeWheel = false;
    assert.equal(f.wheel().prevented, false);
});

test('statistics measure actual elapsed time, toggle through settings and survive video replacement', () => {
    const f = fixture();
    f.key('q');
    assert.equal(f.settings.statistics, true);
    assert.equal(f.changes.length, 1);
    f.advance(2000, 48);
    assert.match(f.nodes.at(-1).textContent, /24.0 FPS.*1920.*1080/);
    const previous = f.nodes.at(-1);
    f.replace();
    assert.equal(previous.isConnected, false);
    assert.equal(f.nodes.at(-1).isConnected, true);
    f.settings.statistics = false;
    f.controller.update();
    assert.equal(f.nodes.at(-1).isConnected, false);
});

test('unsupported statistics API reports unavailable without breaking zoom or resolution', () => {
    const f = fixture();
    f.video.getVideoPlaybackQuality = undefined;
    f.key('q');
    f.advance(1000, 0);
    assert.match(f.nodes.at(-1).textContent, /FPS unavailable.*1920.*1080/);
    f.key('.');
    assert.match(f.video.style.getPropertyValue('transform'), /scale\(1\.3125\)$/);
});

test('title changes restore safely and zoom follows replacement but cleans up on navigation', () => {
    const f = fixture();
    assert.equal(f.document.title, 'Example series Episode 2');
    f.key('.');
    const old = f.video;
    f.replace();
    assert.equal(old.style.getPropertyValue('transform'), '');
    assert.match(f.video.style.getPropertyValue('transform'), /scale\(1\.3125\)$/);
    f.settings.tabTitle = false;
    f.controller.update();
    assert.equal(f.document.title, 'Netflix');
    f.settings.tabTitle = true;
    f.controller.update();
    f.document.title = 'Browse - Netflix';
    f.location.pathname = '/browse';
    f.controller.update();
    assert.equal(f.document.title, 'Browse - Netflix');
    assert.equal(f.video.style.getPropertyValue('transform'), '');
});

test('disabling zoom or ultrawide restores the video and disables the corresponding shortcuts', () => {
    const f = fixture();
    f.key('.');
    f.settings.ultrawide = false;
    f.controller.update();
    assert.equal(f.video.style.getPropertyValue('transform'), '');
    assert.equal(f.key('.').prevented, false);
    f.key('+');
    f.settings.zoom = false;
    f.controller.update();
    assert.equal(f.video.style.getPropertyValue('transform'), '');
    assert.equal(f.key('+').prevented, false);
});
