/**
 * Slice 07 — Provider-agnostic scorecard AI reader interface.
 *
 * The concrete model (Claude / GPT-4o vision) and the prompt are a pending HITL
 * decision. The rest of the system (queue, validation, WhatsApp) depends only on
 * this interface, not the provider, so swapping models touches nothing else.
 *
 * `MockReader` lets the whole flow be exercised end-to-end (upload photo → JSON →
 * validate → queue) without spending on the LLM or waiting for the model decision.
 */
import { parseScorecardReading, type ParsedScorecardReading } from "@/domain/reading-schema";

export interface ReadInput {
  /** Scorecard image bytes. */
  image: ArrayBuffer | Uint8Array;
  /** MIME type (image/jpeg, image/png…). */
  mimeType: string;
}

export interface ScorecardReader {
  read(input: ReadInput): Promise<ParsedScorecardReading>;
}

/**
 * Test reader: returns a fixed (or injected) reading, validated against the
 * schema. Useful in tests and locally without LLM credentials.
 */
export class MockReader implements ScorecardReader {
  constructor(private readonly response: unknown) {}

  async read(): Promise<ParsedScorecardReading> {
    return parseScorecardReading(this.response);
  }
}

/**
 * Prompt shared by the real readers: describes the self-validating scorecard and
 * pins the exact JSON contract (reading-schema). The 3 signals per catch (tens +
 * units marks + handwritten size) and the foot totals are what the checksum
 * validation (slice 08) cross-checks.
 *
 * Tuned against a real "Alto Carrión" plica (src/lib/ai/fixtures/plica-lote17.jpg):
 * without the structural guidance below, the model hallucinates a full catch list
 * from an empty grid. The key is "an empty cell is NOT a catch" + treating the
 * handwritten foot totals as authoritative.
 */
const READING_PROMPT = `Eres un lector experto de "plicas" de papel de concursos de pesca FEPyC (liga "Alto Carrión"). Lee la foto y devuelve SOLO un JSON. NO inventes datos: si una casilla está vacía, NO es una captura.

ESTRUCTURA DE LA PLICA:
- Arriba: número de lote (manuscrito, normalmente arriba a la derecha en rojo) y datos de la manga. Si aparecen, lee también el NOMBRE del pescador y su nº de LICENCIA/federación (sirven para identificar al miembro en competiciones por parejas). Si no se ven, omítelos.
- Cuerpo: una rejilla de casillas numeradas (1, 2, 3, …). CADA casilla es una posible pieza y contiene la etiqueta "Talla:" y DOS filas de dígitos 0-9 (fila de decenas y fila de unidades).
- UNA CASILLA SOLO CUENTA COMO CAPTURA SI tiene dígitos REALMENTE marcados/rodeados (un círculo o marca clara sobre un número de cada fila) Y/O una talla escrita a mano en "Talla:". Una casilla en blanco, o con una raya/aspa diagonal que la cruza (anulación), NO es una captura: ignórala.
- Pie de la plica (datos AUTORITATIVOS, úsalos como checksum y para los totales):
  * "TOTAL CAPTURAS TALLA" = número de capturas de talla legal (legalCatches).
  * "TOTAL CAPTURAS MENORES TALLA" = número de piezas menores de talla (undersizedCatches).
  * "PIEZA MAYOR" = talla en cm de la mayor (biggestCatchCm); si está vacío, 0.

REGLAS:
- Si la rejilla de piezas está vacía (sin marcas), devuelve "catches": [] aunque haya rayas de anulación.
- El número de entradas en "catches" debe coincidir con "legalCatches" del pie. Si no puedes leer marcas individuales pero el pie dice 0, devuelve catches vacío.
- No rellenes capturas para que "cuadre"; prefiere reflejar lo que realmente ves.
- Mira con MUCHA atención los números manuscritos del pie en "TOTAL CAPTURAS TALLA" y "TOTAL CAPTURAS MENORES TALLA" (suele ser un único dígito; un círculo grande es un "0"). Para "undersizedCatches", cuenta además las aspas (X) tachadas en la fila inferior "CAPTURAS MENORES TALLA" (cada aspa = una pieza menor).

Devuelve EXACTAMENTE esta forma ("anglerName" y "license" son OPCIONALES; inclúyelos solo si los lees):
{
  "lot": string,
  "anglerName": string,
  "license": string,
  "catches": [ { "tens": number, "units": number, "handwrittenSize": number } ],
  "totals": { "legalCatches": number, "undersizedCatches": number, "biggestCatchCm": number },
  "confidence": { "lot": number, "catches": number, "totals": number }
}
No incluyas texto fuera del JSON.`;

const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Google Gemini exposes an OpenAI-compatible endpoint, so the same reader works. */
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * Slice 07 — Real reader for any OpenAI-compatible vision API (OpenAI GPT-4o or
 * Google Gemini via its compatibility endpoint). Sends the image as a data URL
 * with JSON-mode output and validates the response against the schema. Kept
 * behind the ScorecardReader interface so nothing else in the system knows the
 * provider — only the base URL + model + key change.
 */
export class OpenAICompatibleReader implements ScorecardReader {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string = OPENAI_BASE_URL,
    private readonly providerName: string = "OpenAI",
  ) {}

  async read(input: ReadInput): Promise<ParsedScorecardReading> {
    const bytes = input.image instanceof Uint8Array ? input.image : new Uint8Array(input.image);
    const dataUrl = `data:${input.mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: READING_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`${this.providerName} reading failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.providerName} returned an empty reading.`);
    return parseScorecardReading(JSON.parse(content));
  }
}

/** Back-compat alias: OpenAI is just the default OpenAI-compatible reader. */
export class OpenAIReader extends OpenAICompatibleReader {
  constructor(apiKey: string, model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o") {
    super(apiKey, model, OPENAI_BASE_URL, "OpenAI");
  }
}

/**
 * Resolves the reader to use, based on `AI_PROVIDER`. Defaults to the mock so the
 * flow runs locally without spending on the LLM (and CI has no key).
 *   - `AI_PROVIDER=gemini` + `GEMINI_API_KEY`: free tier (Google AI Studio), no
 *     credit card; model from `GEMINI_VISION_MODEL` (default gemini-2.0-flash).
 *   - `AI_PROVIDER=openai` + `OPENAI_API_KEY`: GPT-4o (pay-as-you-go).
 */
export function resolveReader(): ScorecardReader {
  const provider = process.env.AI_PROVIDER;
  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("AI_PROVIDER=gemini requires GEMINI_API_KEY.");
    const model = process.env.GEMINI_VISION_MODEL ?? "gemini-2.0-flash";
    return new OpenAICompatibleReader(key, model, GEMINI_BASE_URL, "Gemini");
  }
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("AI_PROVIDER=openai requires OPENAI_API_KEY.");
    return new OpenAIReader(key);
  }
  return new MockReader(DEMO_READING);
}

/** Consistent example reading (to demo the flow without an LLM). */
export const DEMO_READING = {
  lot: "17",
  catches: [
    { tens: 2, units: 0, handwrittenSize: 20 },
    { tens: 2, units: 3, handwrittenSize: 23 },
    { tens: 1, units: 8, handwrittenSize: 18 },
  ],
  totals: { legalCatches: 2, undersizedCatches: 1, biggestCatchCm: 23 },
  confidence: { lot: 0.98, catches: 0.94, totals: 0.96 },
};
