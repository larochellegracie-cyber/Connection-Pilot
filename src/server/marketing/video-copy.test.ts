import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn(async (host: string) => (host === 'private.example.com' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])) } }));

import { copyRemoteVideo, MAX_VIDEO_BYTES } from './video-copy';
import { LocalVolumeStorage } from './standard-video/storage';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mp4 = () => { const b = Buffer.alloc(4096); b.write('ftypisom', 4, 'latin1'); return b; };
const reply = (body: Buffer | string, init: ResponseInit = {}) => new Response(new Uint8Array(typeof body === 'string' ? Buffer.from(body) : body), { status: 200, headers: { 'content-type': 'video/mp4' }, ...init });

let root: string; let storage: LocalVolumeStorage; const fetchMock = vi.fn();
beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'vcopy-')); storage = new LocalVolumeStorage(root, false); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

describe('keeping a finished provider video', () => {
  it('copies a real video into the business’s own storage and returns the app’s own link', async () => {
    fetchMock.mockResolvedValue(reply(mp4()));
    const link = await copyRemoteVideo({ url: 'https://cdn.example.com/v.mp4?sig=abc', tenantId: TENANT, videoId: 'task-0001-aaaa', storage });
    expect(link).toBe('/api/marketing/media/videos/task-0001-aaaa.mp4');
    const stored = await storage.openVideo(TENANT, 'task-0001-aaaa');
    expect(stored?.size).toBe(4096);
    expect(await storage.openVideo('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'task-0001-aaaa')).toBeNull(); // only that business can reach it
  });

  it('does not download it again once it is kept', async () => {
    fetchMock.mockResolvedValue(reply(mp4()));
    await copyRemoteVideo({ url: 'https://cdn.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0002-aaaa', storage });
    fetchMock.mockClear();
    expect(await copyRemoteVideo({ url: 'https://cdn.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0002-aaaa', storage })).toBe('/api/marketing/media/videos/task-0002-aaaa.mp4');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses anything that is not a real video file', async () => {
    fetchMock.mockResolvedValue(reply('<html>Access denied</html>'.repeat(200)));
    await expect(copyRemoteVideo({ url: 'https://cdn.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0003-aaaa', storage })).rejects.toThrow(/not a playable video/);
    expect(await storage.hasVideo(TENANT, 'task-0003-aaaa')).toBe(false);
  });

  it('refuses a failed download, a huge file, and links to private addresses or plain http', async () => {
    fetchMock.mockResolvedValue(reply('nope', { status: 403 }));
    await expect(copyRemoteVideo({ url: 'https://cdn.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0004-aaaa', storage })).rejects.toThrow(/could not be downloaded \(403\)/);
    fetchMock.mockResolvedValue(reply(mp4(), { headers: { 'content-type': 'video/mp4', 'content-length': String(MAX_VIDEO_BYTES + 1) } }));
    await expect(copyRemoteVideo({ url: 'https://cdn.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0005-aaaa', storage })).rejects.toThrow(/too large/);
    fetchMock.mockClear();
    await expect(copyRemoteVideo({ url: 'https://private.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0006-aaaa', storage })).rejects.toThrow(/not allowed/);
    await expect(copyRemoteVideo({ url: 'http://cdn.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0007-aaaa', storage })).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows a redirect only to another public address', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://private.example.com/v.mp4' } }));
    await expect(copyRemoteVideo({ url: 'https://cdn.example.com/v.mp4', tenantId: TENANT, videoId: 'task-0008-aaaa', storage })).rejects.toThrow(/not allowed/);
  });
});
