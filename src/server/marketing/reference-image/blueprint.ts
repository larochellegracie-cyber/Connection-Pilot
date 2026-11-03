import { paletteFrom, type DesignPalette } from '../reference/design.js';
import type { ColourRoles } from '../reference/colour.js';
import { forbiddenFor, type ReferenceText } from '../reference/protect.js';
import type { LogoPosition } from '../reference/logo.js';
import type { Lighting } from './analyze.js';
import { aspects, type Aspect, type Blueprint, type ReferenceImageAnalysis } from './style.js';
import { sizeOf } from './render.js';

/**
 * The structured design blueprint of a reference image: everything about HOW it is designed, and nothing of WHAT it says or shows. It is what the image
 * generator is built from (the drawable layout in `layout` is the part the renderer reads; the rest is the same design in measured, labelled form so it can
 * be shown, checked, and passed to a model-based generator). The reference's own brand names, wording and logo are carried only as `forbidden`/`logo`: a
 * list that is kept OUT of everything made from it, and checked again on the finished picture.
 */
export type ImageDesignBlueprint = {
  aspectRatio: Aspect; size: { width: number; height: number }; kind: string; visualStyle: string; photographyOrGraphic: string;
  composition: string; layout: string; subjectPosition: string; productPlacement: { placement: Blueprint['subject']['placement']; scale: number; shape: Blueprint['subject']['shape']; frame: Blueprint['subject']['frame'] };
  background: { kind: Blueprint['background']['kind']; direction: Blueprint['background']['direction']; vignette: boolean; description: string; /** where a floor begins (fraction of the height) when the reference shows a floor under a backdrop */ horizon: number | null };
  /** the reference's colours by role, and the palette Pilot draws with */ colourRoles: ColourRoles | null; palette: DesignPalette;
  lighting: { direction: string; softness: string; shadows: string; temperature: string; brightness: number; contrast: number; notes: string };
  typography: { style: string; weight: number; caps: boolean; spacing: number; size: string; position: string; align: string };
  textHierarchy: string; spacing: { margin: number; notes: string }; graphicElements: string[]; mood: string[]; designRules: string[];
  /** the reference's own text that must not appear in the new picture (after allowing the owner's own words) */ forbidden: ReferenceText;
  /** the reference's logo: its place, so the new picture can be checked for it */ referenceLogo: { present: boolean; position: LogoPosition };
  /** the drawable layout the renderer follows */ layout_: Blueprint;
};

const nearestAspect = (label: string): Aspect => (aspects as readonly string[]).includes(label) ? (label as Aspect) : '1:1';

export function buildImageBlueprint(analysis: Pick<ReferenceImageAnalysis, 'style' | 'measures'>, ownerWords = ''): ImageDesignBlueprint {
  const { style, measures } = analysis; const bp = style.blueprint; const roles = measures.roles ?? null; const lit: Lighting | undefined = measures.lighting;
  const palette = paletteFrom({ measures: { colourRoles: roles ?? undefined, segments: [] }, style: { theme: bp.tone } } as never);
  const aspect = bp.aspect ?? nearestAspect(measures.aspectRatio); const [width, height] = sizeOf(aspect);
  return {
    aspectRatio: aspect, size: { width, height }, kind: style.kind ?? 'other', visualStyle: style.visualStyle, photographyOrGraphic: style.photographyOrGraphic,
    composition: style.composition, layout: style.layout, subjectPosition: style.subjectPlacement,
    productPlacement: { placement: bp.subject.placement, scale: bp.subject.scale, shape: bp.subject.shape, frame: bp.subject.frame },
    background: { kind: bp.background.kind, direction: bp.background.direction, vignette: bp.background.vignette, description: style.background ?? '', horizon: roles?.separated ? roles.horizon : null },
    colourRoles: roles, palette,
    lighting: { direction: lit?.direction ?? 'even', softness: lit?.softness ?? 'soft', shadows: lit?.shadows ?? 'light', temperature: lit?.temperature ?? 'neutral', brightness: measures.brightness, contrast: measures.contrast, notes: style.lighting },
    typography: { style: style.typography, weight: bp.headline.weight, caps: bp.headline.caps, spacing: bp.headline.spacing, size: bp.headline.size, position: bp.headline.position, align: bp.headline.align },
    textHierarchy: style.textHierarchy ?? style.visualHierarchy, spacing: { margin: bp.margin, notes: style.spacing ?? '' }, graphicElements: style.graphicElements, mood: bp.mood, designRules: style.designRules ?? [],
    forbidden: forbiddenFor(style.referenceText, ownerWords), referenceLogo: style.logo ?? { present: false, position: 'top_left' },
    layout_: bp,
  };
}

/** The blueprint in a few plain lines, for the owner and for the log. */
export function describeBlueprint(b: ImageDesignBlueprint): string {
  return [`${b.aspectRatio} ${b.kind.replace('_', ' ')}, ${b.photographyOrGraphic}, ${b.mood.join(', ') || 'clean'}`, `${b.layout}; type: ${b.typography.style}`, `light from ${b.lighting.direction}, ${b.lighting.softness}, ${b.lighting.shadows} shadows, ${b.lighting.temperature}`,
    b.colourRoles ? `colours: backdrop ${b.colourRoles.background}${b.background.horizon !== null ? `, floor ${b.colourRoles.floor}` : ''}, light ${b.colourRoles.glow}, accent ${b.colourRoles.accent}, text ${b.palette.text ?? ''}` : 'colours: from the business'].join('\n');
}
