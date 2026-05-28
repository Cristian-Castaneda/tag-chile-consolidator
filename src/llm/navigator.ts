// ════════════════════════════════════════════════════════════════════════════
// LLM Navigation Layer.
// When a known selector misses, we screenshot the page and ask Claude (vision)
// to point at the right element — returning a CSS selector and/or coordinates.
// This is a *fallback*; stable selectors in portals.yml are always tried first.
// ════════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import type { Page } from 'playwright';
import { logger } from '../util/logger.js';

export interface LlmNavigatorOptions {
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface LocateResult {
  found: boolean;
  /** A CSS selector that should match the target element, if derivable. */
  selector?: string;
  /** Normalized click coordinates (0..1 of viewport), if no selector is safe. */
  x?: number;
  y?: number;
  reasoning?: string;
}

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report_element',
  description: 'Report the located UI element as a CSS selector and/or normalized coordinates.',
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean', description: 'Whether the requested element is visible.' },
      selector: { type: 'string', description: 'A robust CSS selector for the element, if one can be derived.' },
      x: { type: 'number', description: 'Normalized x of the click point (0=left, 1=right).' },
      y: { type: 'number', description: 'Normalized y of the click point (0=top, 1=bottom).' },
      reasoning: { type: 'string', description: 'One short sentence explaining the choice.' },
    },
    required: ['found'],
  },
};

const SYSTEM = [
  'You are a web-automation assistant. You are given a screenshot of a Chilean toll',
  '("autopista" / TAG) portal and a description of a UI element to find.',
  'Return your answer ONLY by calling the report_element tool.',
  'Prefer a stable CSS selector (id, name, or a unique attribute). If none is safe,',
  'return normalized coordinates of the element center. If it is not visible, set found=false.',
].join(' ');

export class LlmNavigator {
  private client?: Anthropic;

  constructor(private readonly opts: LlmNavigatorOptions) {
    if (opts.enabled && opts.apiKey) {
      this.client = new Anthropic({ apiKey: opts.apiKey });
    }
  }

  /** True when the navigator is configured and ready to use. */
  get active(): boolean {
    return Boolean(this.client);
  }

  /** Ask Claude to locate `description` on the current page. */
  async locate(page: Page, description: string): Promise<LocateResult> {
    if (!this.client) return { found: false };

    let shot: Buffer;
    try {
      shot = await page.screenshot({ fullPage: false });
    } catch {
      return { found: false };
    }
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };

    try {
      const message = await this.client.messages.create({
        model: this.opts.model,
        max_tokens: 512,
        system: SYSTEM,
        tools: [REPORT_TOOL],
        tool_choice: { type: 'tool', name: 'report_element' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Viewport is ${vp.width}x${vp.height} px. Find this element: ${description}`,
              },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: shot.toString('base64') },
              },
            ],
          },
        ],
      });

      for (const block of message.content) {
        if (block.type === 'tool_use' && block.name === 'report_element') {
          const input = block.input as Record<string, unknown>;
          return {
            found: Boolean(input.found),
            selector: typeof input.selector === 'string' ? input.selector : undefined,
            x: typeof input.x === 'number' ? input.x : undefined,
            y: typeof input.y === 'number' ? input.y : undefined,
            reasoning: typeof input.reasoning === 'string' ? input.reasoning : undefined,
          };
        }
      }
      return { found: false };
    } catch (err) {
      logger.debug('LLM navigator request failed:', err instanceof Error ? err.message : String(err));
      return { found: false };
    }
  }
}
