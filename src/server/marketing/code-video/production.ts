import { isRunwayConfigured } from '../runway.js';

/**
 * PRODUCTION METHODS: the ways a video can actually be made. The creative idea picks one, so the idea decides the production method, not the other way round.
 * Each method has its own scene structure, its own producer and its own checks; a method that cannot run here is never offered to ideation.
 *
 *  generated_clip  real motion. Each shot starts from a still (the owner's own photo or a picture Pilot makes) and an image-to-video model animates it for 2 to 10 seconds
 *                  with explicit motion (a camera move, an object moving, a reveal). The shots are cut together and the words are laid over them. Costs video credits.
 *  motion_graphics invented graphics drawn in code: interface cards, chat, counters, chips, kinetic type, a layout that changes state. Free. Best for software, offers, data.
 *  photo_montage   the owner's photographs and generated stills with camera moves, light and type. Free. The fallback, and right when the real photographs are the point.
 */
export type MethodId = 'motion_graphics' | 'product_showcase' | 'character_icon' | 'diagrammatic' | 'generated_clip' | 'photo_montage';
/** which producer makes a method: the timeline renderer (drawn motion, free), image-to-video clips, or the photo-and-type code path (fallback only) */
export const producerOf = (method: MethodId): 'timeline' | 'clips' | 'photo' => (method === 'generated_clip' ? 'clips' : method === 'photo_montage' ? 'photo' : 'timeline');
export const METHODS: Record<MethodId, { label: string; summary: string; available: () => boolean }> = {
  generated_clip: {
    label: 'generated clips (image-to-video)',
    summary: 'REAL MOTION: each shot is a still animated into a 2 to 10 second clip by an image-to-video model, so objects genuinely move, a camera genuinely travels, steam rises, liquid pours, a character walks. Cut together with type over them. Choose it whenever the idea needs physical movement, a character, a journey, a product in motion or atmosphere. Each shot needs an explicit MOTION written as what the camera does and what moves in the frame. No people and no readable text can be generated inside a clip.',
    available: () => isRunwayConfigured() && (process.env.PILOT_CLIP_VIDEO ?? 'on').trim().toLowerCase() !== 'off',
  },
  motion_graphics: {
    label: 'motion graphics / kinetic type',
    summary: 'Drawn on a continuous timeline, free: big kinetic type (words that scale, rise, stagger and change colour on a key word), chips and shapes that drift from chaos into order, counters, a simple recurring icon. Negative space and strong pacing. Choose it for offers, announcements, data, software, and any idea carried by words and change.',
    available: () => true,
  },
  product_showcase: {
    label: 'product showcase (UI mockups and floating cards)',
    summary: 'Drawn on a continuous timeline, free: a phone frame whose screen fills in (cards, rows, chat), floating feature cards that slide around it, icons, a pulsing button, the benefit in big type. Choose it for software, apps, booking, ordering, anything a screen can demonstrate.',
    available: () => true,
  },
  character_icon: {
    label: 'character / icon driven (not built yet)',
    summary: 'Drawn on a continuous timeline, free: a friendly recurring character (with a radar or scanning motif) that enters, reacts and moves through the story, with icons and chips that orbit it or answer it. Choose it when a guide or mascot makes the idea memorable.',
    available: () => false,
  },
  diagrammatic: {
    label: 'diagram / connected nodes (not built yet)',
    summary: 'Drawn on a continuous timeline, free: a hub and nodes (each an icon with a label) that appear one by one, connectors that draw themselves and pulse between them, nodes lighting up in sequence. Choose it to show how pieces connect into one system or process.',
    available: () => false,
  },
  photo_montage: {
    label: 'photo and type (fallback only)',
    summary: 'The owner\'s own photographs and generated stills with camera moves, light and type. Free. FALLBACK ONLY: choose it only when the real photographs themselves are the whole point.',
    available: () => true,
  },
};
export const availableMethods = (): MethodId[] => (Object.keys(METHODS) as MethodId[]).filter((id) => METHODS[id].available());
export const isMethod = (value: unknown): value is MethodId => typeof value === 'string' && value in METHODS;
export const methodsText = (ids: MethodId[] = availableMethods()) => ids.map((id) => `- "${id}" (${METHODS[id].label}): ${METHODS[id].summary}`).join('\n');
