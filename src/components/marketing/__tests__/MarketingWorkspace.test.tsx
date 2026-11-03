import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MarketingWorkspace from '../MarketingWorkspace';
import PhotosAndVoice from '../PhotosAndVoice';

type Item = Record<string, any>;
const makeItem = (id: string, extra: Item = {}): Item => ({ id, kind: 'post', platform: 'instagram', status: 'draft', hook: `Hook ${id}`, caption: `Caption for ${id}`, cta: 'Book now', hashtags: ['#pool'], suggestedVisual: 'The crew at work', postingFormat: 'Reel', topic: `Topic ${id}`, goal: 'Get more bookings', tone: 'Friendly', why: '', evidence: [], scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null, video: null, createdAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z', ...extra });
const video = { durationSeconds: 15, scenes: [{ seconds: 3, visual: 'Cover pulled back', onScreenText: '5 things to check' }, { seconds: 5, visual: 'Pump test', onScreenText: '1. The pump' }], transitions: 'Quick cuts', audioDirection: 'Upbeat', render: { status: 'not_generated' } };

const base = () => ({
  business: { name: 'Somerset Pool Service', type: 'Pool & outdoor services', hasBusinessInformation: true, website: '' },
  brandVoice: { tone: '', description: '' },
  metrics: { createdThisMonth: 0, postsReady: 0, videosReady: 0, videoPlansReady: 0, upcoming: 0, opportunities: 0, trendsWithSources: 0 },
  today: '2026-10-21', timezone: 'America/Toronto', items: [] as Item[],
  signals: [{ id: 'top:pool opening', kind: 'top_service', label: 'Pool opening is your most active service', detail: '14 bookings in the last 90 days.', service: 'Pool opening', asOf: '2026-10-21' }, { id: 'season:fall', kind: 'season', label: 'Fall begins in 3 days', detail: 'The fall season starts on September 22. This comes from the calendar, not from your records.', asOf: '2026-10-21' }],
  trends: null as any, ideas: null as any, hasRealData: true,
  setup: { ai: true, search: true, video: { configured: false, provider: null, message: 'Making the actual video file needs a video provider connection, and none is connected yet.' }, image: { configured: false, provider: null, message: 'Pilot suggests the visual instead.' }, publishing: { connected: false, message: 'No publishing platform is connected. Pilot never posts anything for you.' } },
});

let data: ReturnType<typeof base>;
let calls: Array<{ method: string; url: string; body: any }>;
let respond: (method: string, url: string, body: any) => { status: number; body: any } | null;

beforeEach(() => {
  data = base(); calls = []; respond = () => null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url === '/api/marketing/workspace') { data.metrics.createdThisMonth = data.items.length; return new Response(JSON.stringify(data), { status: 200 }); }
    const custom = respond(method, url, body);
    if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status });
    return new Response('{}', { status: 404 });
  }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.unstubAllGlobals());
const goToBusiness = vi.fn();
const open = async () => { goToBusiness.mockClear(); render(<MarketingWorkspace onGoToBusiness={goToBusiness} />); await screen.findByRole('heading', { name: 'Pilot Marketing' }); };
// photos and the brand voice now live on the Business information page, next to everything else about the business
const openPhotosAndVoice = async () => { render(<PhotosAndVoice />); await screen.findByText('Photos Pilot can use'); };
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

const say = (text: string) => { fireEvent.change(screen.getByLabelText('What do you want Pilot to create?'), { target: { value: text } }); fireEvent.click(screen.getByRole('button', { name: 'Create' })); };
const created = (id: string, extra: Item = {}) => { const item = makeItem(id, extra); data.items = [item, ...data.items]; return item; };

describe('Create: talk to Pilot', () => {
  it('opens on one plain box with no post/video or platform choice', async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'What do you want Pilot to create?' })).toBeTruthy();
    expect(screen.getByLabelText('What do you want Pilot to create?').getAttribute('placeholder')).toBe('Example: Pilot, make me a post for Somerset this weekend.');
    expect(screen.queryByText('More options')).toBeNull(); expect(screen.queryByLabelText('What to make')).toBeNull(); expect(screen.queryByLabelText('Platform')).toBeNull();
    expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual(['Create', 'Pilot’s Ideas', 'Library', 'Scheduled']);
    expect(screen.queryByRole('button', { name: 'Your business & photos' })).toBeNull(); // there is no separate business page inside Marketing any more
    expect(document.body.textContent).not.toMatch(/To review|Approved & scheduled|Everything|More filters/);
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Give me ideas for this week' }));
    expect(screen.getByLabelText('What do you want Pilot to create?')).toHaveProperty('value', 'Give me ideas for this week');
    expect(document.body.textContent).not.toMatch(/ready for review|scheduled this week/); // no dashboard clutter on Create
  });

  it('sends the owner’s own words to Pilot, shows the post it made, and opens it for review', async () => {
    respond = (method, url) => { if (method === 'POST' && url === '/api/marketing/pilot') { const item = created('p1', { hook: 'Close your pool early this year', caption: 'Closing early protects your pool.' }); return { status: 200, body: { reply: { kind: 'created', what: 'post', message: 'Here’s your Instagram post.', item } } }; } return null; };
    await open();
    say('I want a post about why people should close their pool early.');
    expect(await screen.findByText('Here’s your Instagram post.')).toBeTruthy();
    expect(calls.find((call) => call.url === '/api/marketing/pilot')?.body).toEqual({ message: 'I want a post about why people should close their pool early.' });
    expect(screen.getByText('Close your pool early this year')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    expect(within(dialog).getByLabelText('Hook')).toHaveProperty('value', 'Close your pool early this year');
  });

  it('shows a video being made, then plays the real file', async () => {
    const ready = makeItem('v1', { kind: 'video', platform: 'instagram', video: { ...video, render: { status: 'ready', url: '/api/marketing/media/videos/abc.mp4', provider: 'Standard Video' } } });
    respond = (method, url) => {
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = created('v1', { kind: 'video', video: { ...video, render: { status: 'processing', taskId: 't1', provider: 'Standard Video' } } }); return { status: 200, body: { reply: { kind: 'created', what: 'video', message: 'Making your Instagram video now.', item, render: { started: true, taskId: 't1' } } } }; }
      if (method === 'GET' && url === '/api/marketing/content/v1/video') { data.items = [ready]; return { status: 200, body: { ok: true, status: 'ready', item: ready } }; }
      return null;
    };
    await open();
    say('Make me a 20-second Instagram ad for our pool closing service.');
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('/api/marketing/media/videos/abc.mp4'));
    expect(calls.some((call) => /runway|"mode"/i.test(JSON.stringify(call.body ?? {})))).toBe(false);
  });

  it('shows numbered ideas, and “make #3” goes through the same conversation', async () => {
    const ideas = [1, 2, 3].map((n) => ({ id: `idea-${n}`, title: `Idea title ${n}`, why: `Reason ${n}`, format: 'post', platform: 'instagram', hook: '', cta: '', goal: '', evidence: [] }));
    respond = (method, url, body) => {
      if (method === 'POST' && url === '/api/marketing/pilot' && /ideas/.test(body.message)) return { status: 200, body: { reply: { kind: 'ideas', message: 'Here are some ideas. Tap one, or tell me which number to make.', ideas } } };
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = created('p3', { hook: 'Made from idea 3' }); return { status: 200, body: { reply: { kind: 'created', what: 'post', message: 'Here’s your Instagram post.', item } } }; }
      return null;
    };
    await open();
    say('Give me some ideas for what I should post this week.');
    expect(await screen.findByText('Idea title 3')).toBeTruthy();
    expect(screen.getByText('Reason 2')).toBeTruthy();
    fireEvent.click(screen.getByText('Idea title 3').closest('button') as HTMLElement);
    expect(await screen.findByText('Made from idea 3')).toBeTruthy();
    expect(calls.filter((call) => call.url === '/api/marketing/pilot').map((call) => call.body.message)).toEqual(['Give me some ideas for what I should post this week.', 'Make idea #3']);
  });

  it('prepares an AI video but waits for a yes before making it', async () => {
    respond = (method, url) => {
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = created('a1', { kind: 'video', video: { ...video, mode: 'ai' } }); return { status: 200, body: { reply: { kind: 'created', what: 'ai_video', awaitingConfirmation: true, message: 'Here’s the plan for your Instagram video with realistic AI footage. Shall I make it?', item } } }; }
      if (method === 'POST' && url === '/api/marketing/content/a1/video') { const item = { ...data.items[0], video: { ...video, mode: 'ai', render: { status: 'processing', taskId: 'r1', provider: 'AI video' } } }; data.items = [item]; return { status: 202, body: { ok: true, item } }; }
      if (method === 'GET' && url === '/api/marketing/content/a1/video') return { status: 200, body: { status: 'processing', item: data.items[0] } };
      return null;
    };
    await open();
    say('Make me a cinematic video of a pool at sunset');
    await screen.findByText(/Shall I make it\?/);
    expect(calls.some((call) => call.url === '/api/marketing/content/a1/video')).toBe(false); // nothing is started without a yes
    fireEvent.click(screen.getByRole('button', { name: 'Yes, make it' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'POST' && call.url === '/api/marketing/content/a1/video')?.body).toEqual({ mode: 'ai' }));
    expect(await screen.findByText('Making your video…')).toBeTruthy();
  });

  it('shows an honest failure when the AI video could not be made, and keeps the content safe', async () => {
    respond = (method, url) => {
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = created('a1', { kind: 'video', video: { ...video, mode: 'ai' } }); return { status: 200, body: { reply: { kind: 'created', what: 'ai_video', awaitingConfirmation: true, message: 'Here’s the plan. Shall I make it?', item } } }; }
      if (method === 'POST' && url === '/api/marketing/content/a1/video') { const item = { ...data.items[0], video: { ...video, mode: 'ai', render: { status: 'processing', taskId: 'r1', provider: 'Runway' } } }; data.items = [item]; return { status: 202, body: { ok: true, item } }; }
      if (method === 'GET' && url === '/api/marketing/content/a1/video') { const item = { ...data.items[0], video: { ...video, mode: 'ai', render: { status: 'not_generated' } } }; data.items = [item]; return { status: 200, body: { ok: false, status: 'failed', message: 'Runway could not make the video.', item } }; }
      return null;
    };
    await open(); say('Make me a realistic AI video about pool closing');
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, make it' }));
    expect(await screen.findByText(/couldn’t be made\. Nothing was saved/)).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
    expect(screen.queryByText(/video is (ready|finished|done)|your video is|finished/i)).toBeNull(); // nothing claims a video exists
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy(); // the plan is still there
  });

  it('keeps provider wording and credit details away from the owner when a video can’t be started', async () => {
    respond = (method, url) => {
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = created('a1', { kind: 'video', video: { ...video, mode: 'ai' } }); return { status: 200, body: { reply: { kind: 'created', what: 'ai_video', awaitingConfirmation: true, message: 'Shall I make it?', item } } }; }
      if (method === 'POST' && url === '/api/marketing/content/a1/video') return { status: 422, body: { ok: false, message: 'The video was NOT started. Runway could not accept that video request: You do not have enough credits to run this task.' } };
      return null;
    };
    await open(); say('Make me a realistic AI video about pool closing');
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, make it' }));
    expect(await screen.findByText('The video couldn’t be started, so nothing was made. Please try again in a little while.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Runway|credits|NOT started/);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Yes, make it' })).toBeTruthy(); // the plan is intact and can be confirmed again
  });

  it('does not call a video failed just because one check had a hiccup, and plays it once it is really ready', async () => {
    let checks = 0;
    const ready = makeItem('a1', { kind: 'video', video: { ...video, mode: 'ai', render: { status: 'ready', url: '/api/marketing/media/videos/task-abc-123.mp4', provider: 'Runway' } } });
    respond = (method, url) => {
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = created('a1', { kind: 'video', video: { ...video, mode: 'ai' } }); return { status: 200, body: { reply: { kind: 'created', what: 'ai_video', awaitingConfirmation: true, message: 'Shall I make it?', item } } }; }
      if (method === 'POST' && url === '/api/marketing/content/a1/video') { const item = { ...data.items[0], video: { ...video, mode: 'ai', render: { status: 'processing', taskId: 'r1', provider: 'Runway' } } }; data.items = [item]; return { status: 202, body: { ok: true, item } }; }
      if (method === 'GET' && url === '/api/marketing/content/a1/video') { checks += 1; if (checks === 1) return { status: 502, body: { ok: false, status: 'processing', message: 'Could not check' } }; data.items = [ready]; return { status: 200, body: { ok: true, status: 'ready', url: ready.video.render.url, item: ready } }; }
      return null;
    };
    await open(); say('Make me a realistic AI video about pool closing');
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, make it' }));
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe('/api/marketing/media/videos/task-abc-123.mp4'), { timeout: 8000 });
    expect(screen.queryByText(/couldn’t be made/)).toBeNull();
    for (const name of ['Edit', 'Save to Library', 'Add to Calendar']) expect(screen.getByRole('button', { name })).toBeTruthy();
  }, 15000);

  it('asks for business information in plain words when Pilot knows nothing yet', async () => {
    respond = (method, url) => (method === 'POST' && url === '/api/marketing/pilot' ? { status: 409, body: { error: 'Pilot needs to know a little about your business first.', needsBusinessInformation: true } } : null);
    await open();
    say('Make me a post for Somerset');
    expect(await screen.findByText(/Pilot needs to know a little about your business first/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Business information' })[0]);
    expect(goToBusiness).toHaveBeenCalledTimes(1); // every prompt to add business information goes to the Business information page
  });

  it('plans the week when asked, and lands on what needs review', async () => {
    respond = (method, url) => {
      if (method === 'POST' && url === '/api/marketing/pilot') return { status: 200, body: { reply: { kind: 'plan_week', message: 'Planning your week.' } } };
      if (method === 'POST' && url === '/api/marketing/plan') { data.items = [makeItem('w1', { status: 'proposed', topic: 'Planned piece' })]; return { status: 201, body: { items: data.items } }; }
      return null;
    };
    await open(); say('Plan my week');
    expect(await screen.findByText('Planned piece')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Library', selected: true })).toBeTruthy();
  });

  it('never shows keys, providers or other technical words to the owner', async () => {
    data.setup.ai = false;
    await open();
    expect(screen.getByRole('alert').textContent).toBe('Pilot isn’t ready to create things yet. Please contact support.');
    expect(document.body.textContent).not.toMatch(/OpenAI|API key|Firecrawl|Runway|provider|FFmpeg/i);
  });

  it('lets the owner ask Pilot to change what it made', async () => {
    data.items = [makeItem('a')];
    respond = (method, url, body) => (method === 'POST' && url === '/api/marketing/content/a/regenerate' ? { status: 200, body: { item: (data.items = [makeItem('a', { hook: 'Shorter hook' })])[0] } } : null);
    await open(); tab('Library');
    fireEvent.click(screen.getByText('Topic a'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    fireEvent.change(within(dialog).getByLabelText('Ask Pilot to change it'), { target: { value: 'make it shorter' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change it' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('Hook')).toHaveProperty('value', 'Shorter hook'));
    expect(calls.find((call) => call.url === '/api/marketing/content/a/regenerate')?.body).toEqual({ instruction: 'make it shorter' });
  });
});

describe('Business', () => {
  it('shows the photos and brand voice (on the Business information page), and Marketing itself has no business view', async () => {
    await openPhotosAndVoice();
    expect(screen.getByText('Photos Pilot can use')).toBeTruthy();
    expect(screen.getByText('How Pilot sounds')).toBeTruthy();
  });

  it('lists the business’s own photos with what each shows, and asks what a photo shows before adding it', async () => {
    respond = (method, url) => (method === 'GET' && url === '/api/marketing/assets' ? { status: 200, body: { assets: [{ id: 'a1', label: 'Chocolate birthday cake', kind: 'product', url: '/api/marketing/assets/a1' }] } } : null);
    await openPhotosAndVoice();
    expect((await screen.findByAltText('Chocolate birthday cake')).getAttribute('src')).toBe('/api/marketing/assets/a1');
    fireEvent.click(screen.getByRole('button', { name: 'Add photo' }));
    expect(screen.getByText('Choose a photo first.')).toBeTruthy();
  });

  it('lets the owner choose a voice, or describe their own, and Pilot saves it', async () => {
    respond = (method, url) => (method === 'PUT' && url === '/api/marketing/brand-voice' ? { status: 200, body: { brandVoice: {} } } : null);
    await openPhotosAndVoice();
    fireEvent.click(screen.getByRole('radio', { name: 'Funny' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ tone: 'Funny' }));
    expect(await screen.findByText(/Saved. Pilot will use this voice/)).toBeTruthy();
  });
});

describe('approval, scheduling and publishing — owner only', () => {
  const patchServer = () => { respond = (method, url, body) => {
    if (method !== 'PATCH' || !url.startsWith('/api/marketing/content/')) return null;
    const current = data.items[0]; let next = { ...current, ...Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'action')) } as Item;
    if (body.action?.type === 'approve') next = { ...next, status: next.scheduledFor ? 'scheduled' : 'approved', approvedAt: 'now' };
    if (body.action?.type === 'schedule') next = { ...next, status: 'scheduled', scheduledFor: body.action.date };
    if (body.action?.type === 'mark_published') next = { ...next, status: 'published', publishedAt: 'now' };
    data.items = [next]; return { status: 200, body: { item: next } };
  }; };

  it('goes draft → approved → scheduled → published through the owner’s buttons only', async () => {
    data.items = [makeItem('a')]; patchServer();
    await open(); tab('Library');
    fireEvent.click(screen.getByText('Topic a'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    expect(within(dialog).queryByRole('button', { name: /mark as published/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Schedule' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Schedule for'), { target: { value: '2026-10-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /I posted this — mark as published/ }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('Posted')).toBeTruthy());
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body.action.type)).toEqual(['approve', 'schedule', 'mark_published']);
    // the page tells the owner Pilot never posts for them, and no call goes anywhere except Pilot's own API
    expect(within(screen.getByRole('dialog')).getByText(/Pilot never posts anything for you/)).toBeTruthy();
    expect(calls.every((call) => call.url.startsWith('/api/marketing/'))).toBe(true);
  });

  it('warns that editing approved content sends it back to draft', async () => {
    data.items = [makeItem('a', { status: 'approved', approvedAt: 'x' })]; patchServer();
    await open(); tab('Library');
    fireEvent.click(screen.getByText('Topic a'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    fireEvent.change(within(dialog).getByLabelText('Caption'), { target: { value: 'New wording' } });
    expect(within(dialog).getByText(/Saving sends it back to draft/)).toBeTruthy();
  });

  it('can regenerate and delete content', async () => {
    data.items = [makeItem('a')];
    respond = (method, url) => {
      if (method === 'POST' && url.endsWith('/regenerate')) { const item = makeItem('a', { hook: 'A fresh hook' }); data.items = [item]; return { status: 200, body: { item } }; }
      if (method === 'DELETE') { data.items = []; return { status: 200, body: { ok: true } }; }
      return null;
    };
    await open(); tab('Library');
    fireEvent.click(screen.getByText('Topic a'));
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('Hook')).toHaveProperty('value', 'A fresh hook'));
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  });
});

describe('video concepts and the provider requirement', () => {
  it('shows the full video plan, and says a provider is needed to make the file', async () => {
    data.items = [makeItem('v', { kind: 'video', platform: 'tiktok', video, status: 'approved' })];
    respond = (method, url) => (method === 'POST' && url.endsWith('/video') ? { status: 501, body: { ok: false, providerRequired: true, message: 'Making the actual video file needs a video provider connection, and none is connected yet.' } } : null);
    await open(); tab('Library');
    fireEvent.click(screen.getByText('Topic v'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    expect(within(dialog).getByText(/Video plan · 15 seconds/)).toBeTruthy();
    expect(within(dialog).getAllByDisplayValue('5 things to check')).toHaveLength(1);
    expect(within(dialog).getByLabelText('Transitions')).toHaveProperty('value', 'Quick cuts');
    expect(within(dialog).getByLabelText('Music and audio direction')).toHaveProperty('value', 'Upbeat');
    expect(within(dialog).getByText('Video not made yet. This is the plan.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make the video' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/can.t make that kind of video yet/);
    expect(screen.queryByText(/Video created|Your video is ready/i)).toBeNull();
    expect(within(dialog).queryByRole('link', { name: 'Open the video' })).toBeNull();
  });

  it('only shows a video as made when a real file exists', async () => {
    data.items = [makeItem('v', { kind: 'video', platform: 'tiktok', status: 'approved', video: { ...video, render: { status: 'ready', url: 'https://cdn.example.com/v.mp4', provider: 'Acme Video' } } })];
    await open(); tab('Library');
    fireEvent.click(screen.getByText('Topic v'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    expect(within(dialog).getAllByRole('link', { name: 'Open the video' })[0].getAttribute('href')).toBe('https://cdn.example.com/v.mp4');
    expect(within(dialog).getByText(/Made with Acme Video/)).toBeTruthy();
  });
});


describe('Plan my week', () => {
  const planned = [makeItem('p1', { status: 'proposed', scheduledFor: '2026-10-22', topic: 'Spring opening checklist' }), makeItem('p2', { status: 'proposed', kind: 'video', platform: 'tiktok', video, scheduledFor: '2026-10-24', topic: 'Opening mistakes' })];

  it('approves everything Pilot planned only when the owner presses Approve all', async () => {
    data.items = planned;
    respond = (method, url, body) => { if (url === '/api/marketing/plan/decision') { data.items = data.items.map((item) => (body.ids.includes(item.id) ? { ...item, status: 'scheduled' } : item)); return { status: 200, body: { ok: true } }; } return null; };
    await open(); tab('Library');
    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    await waitFor(() => expect(calls.find((call) => call.url === '/api/marketing/plan/decision')?.body).toEqual({ ids: ['p1', 'p2'], decision: 'approve' }));
  });
});

describe('Library', () => {
  it('holds what Pilot made that is not on the calendar, as simple cards in plain words', async () => {
    data.items = [makeItem('a', { status: 'draft' }), makeItem('b', { status: 'approved', platform: 'facebook' }), makeItem('c', { status: 'published', kind: 'video', video }), makeItem('d', { status: 'scheduled', scheduledFor: '2026-10-25' })];
    await open(); tab('Library');
    expect(screen.getAllByRole('listitem')).toHaveLength(2); // scheduled and posted content lives on the calendar
    const card = (name: string) => screen.getByText(name).closest('button') as HTMLElement;
    expect(card('Topic a').textContent).toContain('Ready to review');
    expect(card('Topic b').textContent).toContain('Approved');
    expect(card('Topic b').textContent).toContain('Post · Facebook');
    for (const hidden of ['Topic c', 'Topic d']) expect(screen.queryByText(hidden)).toBeNull();
    expect(screen.queryByRole('tab', { name: /All|To review|Approved|Published/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Proposed|Draft\b|More filters|Everything|Scheduled for/);
  });

  it('adds a simple search once there is plenty to look through', async () => {
    data.items = Array.from({ length: 8 }, (_, index) => makeItem(`x${index}`, { topic: index === 3 ? 'Pool closing reminder' : `Other ${index}` }));
    await open(); tab('Library');
    fireEvent.change(screen.getByLabelText('Search your library'), { target: { value: 'closing' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('approves everything Pilot planned only when asked', async () => {
    data.items = [makeItem('p1', { status: 'proposed' }), makeItem('p2', { status: 'proposed' })];
    respond = (method, url, body) => { if (url === '/api/marketing/plan/decision') { data.items = data.items.map((item) => (body.ids.includes(item.id) ? { ...item, status: 'approved' } : item)); return { status: 200, body: { ok: true } }; } return null; };
    await open(); tab('Library');
    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    await waitFor(() => expect(calls.find((call) => call.url === '/api/marketing/plan/decision')?.body).toEqual({ ids: ['p1', 'p2'], decision: 'approve' }));
  });

  it('shows an empty state with nothing in it', async () => {
    await open(); tab('Library');
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
  });
});

describe('Scheduled: a real calendar', () => {
  const scheduledItems = () => [
    makeItem('a', { status: 'scheduled', scheduledFor: '2026-10-22', scheduledTime: '14:30', topic: 'Spring opening post' }),
    makeItem('b', { kind: 'video', status: 'scheduled', scheduledFor: '2026-10-22', scheduledTime: '09:00', topic: 'Closing video', video }),
    makeItem('c', { status: 'draft', topic: 'Not scheduled' }), makeItem('d', { status: 'published', scheduledFor: '2026-10-20', topic: 'Already posted' }),
  ];

  it('shows scheduled posts and videos on their dates, in order, with posts and videos clearly different', async () => {
    data.items = scheduledItems();
    await open(); tab('Scheduled');
    expect(screen.getByText('October 2026')).toBeTruthy();
    const day = document.querySelector('[data-day="2026-10-22"]') as HTMLElement;
    const chips = within(day).getAllByRole('button');
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual(['Video, Instagram, 9:00 a.m.: Closing video', 'Post, Instagram, 2:30 p.m.: Spring opening post']);
    expect(chips[0].className).toContain('bg-[#0B1F44]'); expect(chips[1].className).toContain('bg-[#DCE7FF]'); // video dark, post light
    expect(within(document.querySelector('[data-day="2026-10-20"]') as HTMLElement).getByRole('button', { name: /posted: Already posted/ })).toBeTruthy();
    expect(screen.queryByText('Not scheduled')).toBeNull();
  });

  it('opens the content when an item is clicked', async () => {
    data.items = scheduledItems();
    await open(); tab('Scheduled');
    fireEvent.click(within(document.querySelector('[data-day="2026-10-22"]') as HTMLElement).getByRole('button', { name: /Post, Instagram, 2:30 p.m./ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    expect(within(dialog).getByLabelText('Hook')).toHaveProperty('value', 'Hook a');
  });

  it('switches to a week view and moves between weeks', async () => {
    data.items = scheduledItems();
    await open(); tab('Scheduled');
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByText(/Sun, Oct 18 – Sat, Oct 24, 2026/)).toBeTruthy();
    expect(document.querySelectorAll('[data-day]')).toHaveLength(7);
    expect(within(document.querySelector('[data-day="2026-10-22"]') as HTMLElement).getByText('Spring opening post')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(screen.getByText(/Sun, Oct 25 – Sat, Oct 31, 2026/)).toBeTruthy();
    expect(screen.queryByText('Spring opening post')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('moves content to another day when dropped, and keeps its time', async () => {
    data.items = scheduledItems();
    respond = (method, url, body) => (method === 'PATCH' ? { status: 200, body: { item: { ...data.items[0], scheduledFor: body.action.date } } } : null);
    await open(); tab('Scheduled');
    const chip = within(document.querySelector('[data-day="2026-10-22"]') as HTMLElement).getByRole('button', { name: /Post, Instagram/ });
    const dataTransfer = { setData: vi.fn(), getData: () => 'a' };
    fireEvent.dragStart(chip, { dataTransfer });
    fireEvent.drop(document.querySelector('[data-day="2026-10-28"]') as HTMLElement, { dataTransfer });
    await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ action: { type: 'move', date: '2026-10-28' } }));
  });

  it('explains how things get on the calendar when it is empty', async () => {
    await open(); tab('Scheduled');
    expect(screen.getByText(/Add to Calendar/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('November 2026')).toBeTruthy();
  });
});

describe('Pilot’s Ideas', () => {
  const idea = (n: number) => ({ id: `idea-${n}`, title: `Pool closing season is coming ${n}`, why: 'Customers should book early. Closing dates fill fast.', format: 'post', platform: 'instagram', hook: '', cta: '', goal: '', evidence: [] });

  it('is a simple feed: a short title, one sentence of why, and Make it', async () => {
    data.ideas = { ideas: [idea(1), idea(2)], savedAt: 'now' };
    await open(); tab('Pilot’s Ideas');
    expect(screen.getAllByRole('button', { name: 'Make it' })).toHaveLength(2);
    expect(screen.getAllByText('Customers should book early.')).toHaveLength(2); // one sentence only
    expect(screen.queryByText(/Closing dates fill fast/)).toBeNull();
    expect(calls.some((call) => call.url === '/api/marketing/ideas')).toBe(false); // saved ideas are reused, not paid for again
  });

  it('sends the idea straight into Create, which makes it', async () => {
    data.ideas = { ideas: [idea(1), idea(2)], savedAt: 'now' };
    respond = (method, url) => { if (method === 'POST' && url === '/api/marketing/pilot') { const item = makeItem('m1', { hook: 'Book your pool closing early' }); data.items = [item]; return { status: 200, body: { reply: { kind: 'created', what: 'post', message: 'Here’s your Instagram post.', item } } }; } return null; };
    await open(); tab('Pilot’s Ideas');
    fireEvent.click(screen.getAllByRole('button', { name: 'Make it' })[1]);
    expect(screen.getByRole('tab', { name: 'Create', selected: true })).toBeTruthy();
    expect(await screen.findByText('Make it: Pool closing season is coming 2')).toBeTruthy();
    expect(await screen.findByText('Book your pool closing early')).toBeTruthy();
    expect(calls.find((call) => call.url === '/api/marketing/pilot')?.body).toMatchObject({ ideaId: 'idea-2' });
    expect(screen.getByRole('button', { name: 'Add to Calendar' })).toBeTruthy();
  });

  it('comes up with ideas on its own the first time, and can show new ones', async () => {
    respond = (method, url, body) => (method === 'POST' && url === '/api/marketing/ideas' ? { status: 200, body: { ideas: [idea(body.refresh ? 9 : 1)] } } : null);
    await open(); tab('Pilot’s Ideas');
    expect(await screen.findByText('Pool closing season is coming 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show me new ideas' }));
    expect(await screen.findByText('Pool closing season is coming 9')).toBeTruthy();
  });

  it('does not spend anything when Pilot cannot write yet', async () => {
    data.setup.ai = false;
    await open(); tab('Pilot’s Ideas');
    expect(screen.getByText(/Pilot isn’t ready to create things yet/)).toBeTruthy();
    expect(calls.some((call) => call.url === '/api/marketing/ideas')).toBe(false);
  });
});

describe('after Pilot makes something: Edit, Save to Library, Add to Calendar', () => {
  const serve = () => {
    respond = (method, url, body) => {
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = makeItem('p1', { hook: 'Close your pool early' }); data.items = [item]; return { status: 200, body: { reply: { kind: 'created', what: 'post', message: 'Here’s your Instagram post.', item } } }; }
      if (method === 'PATCH' && url === '/api/marketing/content/p1') {
        let next = { ...data.items[0] } as Item;
        if (body.platform) next.platform = body.platform;
        if (body.action?.type === 'approve') next = { ...next, status: 'approved' };
        if (body.action?.type === 'schedule') next = { ...next, status: 'scheduled', scheduledFor: body.action.date, scheduledTime: body.action.time };
        data.items = [next]; return { status: 200, body: { item: next } };
      }
      return null;
    };
  };

  it('keeps the piece in the Library when the owner only saves it, and never schedules by itself', async () => {
    serve(); await open();
    say('Pilot, make me a post for Somerset this weekend.');
    expect(await screen.findByText('Close your pool early')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false); // nothing scheduled or approved until asked
    fireEvent.click(screen.getByRole('button', { name: 'Save to Library' }));
    expect(await screen.findByText(/Saved to your Library/)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body.action.type)).toEqual(['approve']);
    tab('Library');
    expect(screen.getByText('Topic p1')).toBeTruthy();
  });

  it('adds it to the calendar on the chosen date and time, suggests “this weekend”, and shows it on the calendar', async () => {
    serve(); await open();
    say('Pilot, make me a post for Somerset this weekend.');
    await screen.findByText('Close your pool early');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Calendar' }));
    const form = screen.getByRole('group', { name: 'Add to Calendar' });
    expect(within(form).getByLabelText('Date')).toHaveProperty('value', '2026-10-24'); // Saturday after Wednesday 21 Oct
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-25' } });
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '10:30' } });
    fireEvent.change(within(form).getByLabelText('Platform'), { target: { value: 'facebook' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/Added to your calendar for Sunday, October 25 at 10:30 a.m./)).toBeTruthy();
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([{ platform: 'facebook' }, { action: { type: 'approve' } }, { action: { type: 'schedule', date: '2026-10-25', time: '10:30' } }]);
    fireEvent.click(screen.getByRole('button', { name: 'See Calendar' }));
    expect(screen.getByRole('tab', { name: 'Scheduled', selected: true })).toBeTruthy();
    const day = document.querySelector('[data-day="2026-10-25"]') as HTMLElement;
    fireEvent.click(within(day).getByRole('button', { name: /Post, Facebook, 10:30 a\.m\./ }));
    expect(await screen.findByRole('dialog', { name: 'Edit content' })).toBeTruthy();
    // and it has left the Library
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); tab('Library');
    expect(screen.queryByText('Topic p1')).toBeNull();
  });

  it('keeps the conversation when the owner looks at another tab and comes back', async () => {
    serve(); await open();
    say('Make me a post'); await screen.findByText('Close your pool early');
    tab('Library'); tab('Create');
    expect(screen.getByText('Close your pool early')).toBeTruthy();
  });

  it('shows the picture Pilot made together with the words, and the three actions', async () => {
    respond = (method, url) => { if (method === 'POST' && url === '/api/marketing/pilot') { const item = makeItem('p1', { hook: 'Close your pool early', image: { url: '/api/marketing/media/images/abcdef12-3456.jpg', prompt: 'A cover on a pool' } }); data.items = [item]; return { status: 200, body: { reply: { kind: 'created', what: 'post', message: 'Here’s your Instagram post.', item } } }; } return null; };
    await open(); say('Pilot, make me a post for Somerset this weekend.');
    expect(await screen.findByText('Close your pool early')).toBeTruthy();
    expect(screen.getByText('Caption for p1')).toBeTruthy();
    expect(screen.getByAltText('The picture for this post').getAttribute('src')).toBe('/api/marketing/media/images/abcdef12-3456.jpg');
    for (const name of ['Edit', 'Save to Library', 'Add to Calendar']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make a picture' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/photo a\d|prompt/i);
  });

  it('never pretends there is a picture: a post without one offers to make it', async () => {
    respond = (method, url) => {
      if (method === 'POST' && url === '/api/marketing/pilot') { const item = makeItem('p1', { hook: 'Close your pool early' }); data.items = [item]; return { status: 200, body: { reply: { kind: 'created', what: 'post', message: 'Here’s your Instagram post. I couldn’t make the picture just now. You can ask me to try again.', item } } }; }
      if (method === 'POST' && url === '/api/marketing/content/p1/image') { const item = makeItem('p1', { hook: 'Close your pool early', image: { url: '/api/marketing/media/images/zzzzzz99-0000.jpg', prompt: 'x' } }); data.items = [item]; return { status: 200, body: { item } }; }
      return null;
    };
    await open(); say('Make me a post');
    expect(await screen.findByText(/couldn’t make the picture/)).toBeTruthy();
    expect(screen.queryByAltText('The picture for this post')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Make a picture' }));
    expect((await screen.findByAltText('The picture for this post')).getAttribute('src')).toBe('/api/marketing/media/images/zzzzzz99-0000.jpg');
    expect(screen.queryByRole('button', { name: 'Make a picture' })).toBeNull();
  });

  it('shows the picture in the Library card and in the review preview, where a new one can be made', async () => {
    data.items = [makeItem('p1', { image: { url: '/api/marketing/media/images/abcdef12-3456.jpg', prompt: 'x' } })];
    await open(); tab('Library');
    expect(document.querySelector('main ul img')?.getAttribute('src')).toBe('/api/marketing/media/images/abcdef12-3456.jpg');
    fireEvent.click(screen.getByText('Topic p1'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    expect(within(dialog).getByAltText('The picture for this post')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Make a new picture' })).toBeTruthy();
  });

  it('says "Picture made by Pilot" only for a picture Pilot made, never for the owner’s own photo', async () => {
    data.items = [makeItem('g1', { topic: 'Made one', image: { url: '/api/marketing/media/images/abcdef12-3456.jpg', prompt: 'x', source: 'generated' } }), makeItem('o1', { topic: 'Own photo', image: { url: '/api/marketing/assets/abcdef12-3456', prompt: 'Pool cover', source: 'photo' } })];
    await open(); tab('Library');
    fireEvent.click(screen.getByText('Made one'));
    expect(within(await screen.findByRole('dialog', { name: 'Edit content' })).getByText('Picture made by Pilot')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByText('Own photo'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit content' });
    expect(within(dialog).getByAltText('The picture for this post')).toBeTruthy();
    expect(within(dialog).queryByText('Picture made by Pilot')).toBeNull();
  });
});

describe('a confirmed brief becomes a video', () => {
  const jobReply = { kind: 'job', message: 'Marketing Creative Mode: confirmed. This brief is locked in: I’m making your video now.', jobId: 'job-1' };
  const ready = { id: 'job-1', status: 'ready', progress: null, result: { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4', caption: 'Closing your pool this weekend? We handle it.', hashtags: ['#PoolClosing', '#WindsorEssex'], cta: 'Call (519) 982-4901', total_seconds: 15, music: 'Soft and elegant: wide, gentle pads with slow chords and no hard drums, 72 BPM', error: null } };
  const wire = (...polls: Array<Record<string, unknown>>) => { let n = 0; respond = (method, url) => { if (method === 'POST' && url === '/api/marketing/pilot') return { status: 200, body: { reply: jobReply } }; if (method === 'GET' && url === '/api/marketing/jobs/job-1') return { status: 200, body: polls[Math.min(n++, polls.length - 1)] }; return null; }; };

  it('follows the job while the video is made, then shows the video, the caption, and Copy caption and Download', async () => {
    wire({ id: 'job-1', status: 'generating', progress: { phase: 'making', done: 1, total: 4 }, result: null }, ready);
    await open(); say('looks good');
    expect(await screen.findByText(/I’m making your video now/)).toBeTruthy();
    expect(await screen.findByText('Making your scenes (1 of 4 done)…')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe(ready.result.video_url), { timeout: 9000 });
    expect(screen.getByText('Closing your pool this weekend? We handle it.')).toBeTruthy(); expect(screen.getByText('#PoolClosing #WindsorEssex')).toBeTruthy();
    expect(document.querySelector('video')?.hasAttribute('controls')).toBe(true);
    const download = screen.getByRole('link', { name: /Download/ }); expect(download.getAttribute('href')).toBe(`${ready.result.video_url}?download=1`); expect(download.hasAttribute('download')).toBe(true);
    expect(screen.getByText(/Music: Soft and elegant: wide, gentle pads/)).toBeTruthy(); expect(screen.getByText(/nothing to license/)).toBeTruthy(); expect(screen.queryByText(/no sound/i)).toBeNull(); // the old “it’s silent” note is gone
    const writeText = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: /Copy caption/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Closing your pool this weekend? We handle it.\n\nCall (519) 982-4901\n\n#PoolClosing #WindsorEssex'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual(['Create', 'Pilot’s Ideas', 'Library', 'Scheduled']); // the four tabs are unchanged
  }, 30_000);

  it('shows the video straight away when it is already ready, and never posts anything', async () => {
    wire(ready);
    await open(); say('yes');
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe(ready.result.video_url));
    expect(calls.some((call) => call.method !== 'GET' && !/\/api\/marketing\/pilot$/.test(call.url))).toBe(false);
  }, 30_000);

  it('says plainly why when the video could not be made, with no video shown', async () => {
    wire({ id: 'job-1', status: 'failed', progress: null, result: { video_url: null, caption: '', hashtags: [], cta: '', total_seconds: 0, error: 'A scene took too long to make and was stopped.' } });
    await open(); say('yes');
    expect(await screen.findByText('A scene took too long to make and was stopped.')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull(); expect(screen.queryByRole('button', { name: /Copy caption/ })).toBeNull();
  }, 30_000);

  it('tells the owner honestly when the music could not be added, and shows the “Adding music…” step', async () => {
    wire({ id: 'job-1', status: 'generating', progress: { phase: 'music', done: 4, total: 4 }, result: null }, { ...ready, result: { ...ready.result, music: null } });
    await open(); say('looks good');
    expect(await screen.findByText('Adding music…')).toBeTruthy();
    expect(await screen.findByText(/This video has no sound/, {}, { timeout: 9000 })).toBeTruthy(); expect(screen.getByRole('link', { name: /Download/ })).toBeTruthy(); // still delivered, with Copy caption and Download
    expect(screen.getByRole('button', { name: /Copy caption/ })).toBeTruthy();
  }, 30_000);

  it('says a free animated video is free: no Runway, and the free-animation note instead of the AI-footage one', async () => {
    const animated = { ...ready, result: { ...ready.result, engine: 'animated', music: 'Clean modern: a clean, steady beat under soft pads, 100 BPM' } };
    wire({ id: 'job-1', status: 'generating', progress: { phase: 'making', done: 0, total: 0 }, result: null }, animated);
    await open(); say('Make me a video about pool closing');
    expect(await screen.findByText('Creating your free animated video…')).toBeTruthy(); // no “scenes (0 of 0)”
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe(ready.result.video_url), { timeout: 9000 });
    expect(screen.getByText(/Made with Pilot’s free animation: your photos where they fit, brand colours, text and motion\. No Runway credits were used\./)).toBeTruthy(); expect(screen.getByText(/Music: Clean modern/)).toBeTruthy();
    expect(screen.queryByText(/AI-generated footage/)).toBeNull(); expect(screen.getByRole('button', { name: /Copy caption/ })).toBeTruthy(); expect(screen.getByRole('link', { name: /Download/ })).toBeTruthy();
  }, 30_000);

  it('says a Runway video was made with Runway (AI-generated footage)', async () => {
    wire({ ...ready, result: { ...ready.result, engine: 'runway' } });
    await open(); say('yes');
    await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toBe(ready.result.video_url));
    expect(screen.getByText(/Made with Runway \(AI-generated footage\)\. Music:/)).toBeTruthy(); expect(screen.queryByText(/free animation/)).toBeNull();
  }, 30_000);
});

describe('everything stays inside the chat', () => {
  const brief = 'Marketing Creative Mode is on. Here’s what I understood:\n\n• Platform: Instagram\n• Type: a video, about 20 seconds\n• About: pool closing\n\nYour media for this: None of your 1 file fit “pool closing” well. I’d use a branded graphic.\n\nCreating a free animated video… It uses no Runway credits and takes about a minute.';

  it('puts the request, the brief, the media note and the cost line in the conversation as separate Pilot messages, in order', async () => {
    respond = (method, url) => (method === 'POST' && url === '/api/marketing/pilot' ? { status: 200, body: { reply: { kind: 'message', message: brief } } } : null);
    await open(); say('Make me a 20 second Instagram video about pool closing.');
    expect(await screen.findByText('Here’s what I understood:')).toBeTruthy();
    expect(screen.queryByText(/Marketing Creative Mode/)).toBeNull(); // the internal label is not shown to the owner
    const chat = screen.getByRole('list', { name: 'Conversation with Pilot' });
    expect(within(chat).getByText('Platform: Instagram')).toBeTruthy();
    expect(within(chat).getByText(/None of your 1 file fit/)).toBeTruthy();
    expect(within(chat).getByText(/uses no Runway credits/)).toBeTruthy();
    // the text box lives in the same panel as the conversation, under it
    const panel = screen.getByRole('region', { name: 'Ask Pilot' });
    expect(panel.contains(chat) && panel.contains(screen.getByLabelText('What do you want Pilot to create?'))).toBe(true);
    const messages = within(chat).getAllByRole('listitem').map((node) => node.textContent ?? '');
    expect(messages.findIndex((text) => text.includes('Make me a 20 second'))).toBeGreaterThan(0); // the greeting comes first, then the request
  });

  it('tells the stages of the video as chat messages: each finished one is ticked, then the finished video arrives as the last message', async () => {
    const jobReply = { kind: 'job', message: 'Creating a free animated video… It uses no Runway credits.', jobId: 'job-1' };
    const polls = [{ id: 'job-1', status: 'generating', progress: { phase: 'planning', done: 0, total: 0 }, result: null }, { id: 'job-1', status: 'generating', progress: { phase: 'making', done: 0, total: 0 }, result: null }, { id: 'job-1', status: 'ready', progress: null, result: { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4', caption: 'Closing your pool?', hashtags: [], cta: '', total_seconds: 20, music: null, engine: 'animated', error: null } }];
    let n = 0; respond = (method, url) => (method === 'POST' && url === '/api/marketing/pilot' ? { status: 200, body: { reply: jobReply } } : method === 'GET' && url === '/api/marketing/jobs/job-1' ? { status: 200, body: polls[Math.min(n++, 2)] } : null);
    await open(); say('Make me a video about pool closing');
    expect(await screen.findByText('Planning your scenes…')).toBeTruthy();
    expect(await screen.findByText('Creating your free animated video…', {}, { timeout: 9000 })).toBeTruthy();
    expect(screen.getByText('Planning your scenes')).toBeTruthy(); // the finished stage stays in the conversation, without the dots
    expect(await screen.findByText('Your video is ready.', {}, { timeout: 12000 })).toBeTruthy();
    const chat = screen.getByRole('list', { name: 'Conversation with Pilot' });
    expect(chat.contains(document.querySelector('video'))).toBe(true); expect(chat.contains(screen.getByRole('button', { name: /Copy caption/ }))).toBe(true);
    expect(screen.queryByRole('status')).toBeNull(); // nothing is left spinning
  }, 40_000);
});


describe('one place for business information', () => {
  it('the Ideas tab sends the owner to Business information too, and no tab or link opens a business page inside Marketing', async () => {
    data.hasRealData = false;
    await open(); tab('Pilot’s Ideas');
    fireEvent.click(screen.getByRole('button', { name: 'Open Business information' }));
    expect(goToBusiness).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tabpanel', { name: 'Your business' })).toBeNull();
    expect(screen.queryByText('Website, brand and marketing details')).toBeNull();
  });
});

describe('photos from the website', () => {
  const photos = [
    { id: 'own1', label: 'Chocolate birthday cake', kind: 'product', url: '/api/marketing/assets/own1', tags: [] },
    { id: 'w1', label: 'From website – logo', kind: 'logo', url: '/api/marketing/assets/w1', tags: ['website', 'web-aaaaaaaaaaaa'] },
    { id: 'w2', label: 'From website – pool technician', kind: 'photo', url: '/api/marketing/assets/w2', tags: ['website', 'web-bbbbbbbbbbbb'] },
  ];
  it('shows them next to the owner’s own uploads, labelled and badged so they can be reviewed and deleted', async () => {
    respond = (method, url) => (method === 'GET' && url === '/api/marketing/assets' ? { status: 200, body: { assets: photos } } : null);
    await openPhotosAndVoice();
    expect(await screen.findByAltText('Chocolate birthday cake')).toBeTruthy();
    expect(screen.getByAltText('From website – pool technician')).toBeTruthy();
    expect(screen.getByText('Website logo')).toBeTruthy(); expect(screen.getByText('From website')).toBeTruthy();
    expect(screen.getByText(/2 from your website\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete From website – pool technician' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeTruthy(); // manual upload still there
    expect(screen.getByText('How Pilot sounds')).toBeTruthy(); // so is the brand voice
  });

  it('reloads the list when reading a website saves new photos', async () => {
    let list = photos.slice(0, 1);
    respond = (method, url) => (method === 'GET' && url === '/api/marketing/assets' ? { status: 200, body: { assets: list } } : null);
    await openPhotosAndVoice();
    await screen.findByAltText('Chocolate birthday cake');
    list = photos; window.dispatchEvent(new Event('pilot:photos-changed'));
    expect(await screen.findByAltText('From website – pool technician')).toBeTruthy();
  });
});


describe('Create is a full-page chat', () => {
  it('has no outer “What do you want Pilot to create?” card: the conversation scrolls and the box to type in is fixed at the bottom', async () => {
    await open();
    const heading = screen.getByRole('heading', { name: 'What do you want Pilot to create?' });
    expect(heading.className).toContain('sr-only'); // kept for screen readers, not shown as a card title
    const panel = screen.getByRole('region', { name: 'Ask Pilot' });
    expect(panel.className).toContain('flex-col'); expect(panel.className).toContain('h-[calc(100dvh'); // fills the page height
    expect(panel.className).not.toContain('cp-card'); expect(panel.querySelector('.cp-hero')).toBeNull();
    const chat = screen.getByRole('list', { name: 'Conversation with Pilot' });
    const scroller = chat.parentElement as HTMLElement; expect(scroller.className).toContain('overflow-y-auto');
    const composer = screen.getByLabelText('What do you want Pilot to create?').closest('div[class*="shrink-0"]') as HTMLElement;
    expect(composer).toBeTruthy(); expect(scroller.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the input comes after (below) the messages
    expect(screen.getByText(/Just tell me and I’ll make it/)).toBeTruthy();
  });
});

describe('code-drawn videos', () => {
  it('says so on the finished video, and is silent about it for the standard renderer', async () => {
    const done = (renderer: string) => ({ id: 'job-1', status: 'ready', progress: null, result: { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4', caption: 'Closing your pool?', hashtags: [], cta: '', total_seconds: 20, music: null, engine: 'animated', renderer, error: null } });
    respond = (method, url) => (method === 'POST' && url === '/api/marketing/pilot' ? { status: 200, body: { reply: { kind: 'job', message: 'Creating a free animated video…', jobId: 'job-1' } } } : method === 'GET' && url === '/api/marketing/jobs/job-1' ? { status: 200, body: done('code') } : null);
    await open(); say('Make me a custom animation about pool closing');
    expect(await screen.findByText(/Drawn from a custom animation script Pilot wrote/, {}, { timeout: 9000 })).toBeTruthy();
  }, 30_000);
});

