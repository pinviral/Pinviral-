import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || "" });

export interface PinContent {
  title: string;
  description: string;
}

export async function generatePinContent(
  sourceTitle: string,
  sourceDescription: string,
  trends: string[]
): Promise<PinContent[]> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `Act as a world-class Pinterest Algorithm Expert and Master Copywriter. Your goal is to create 5 highly viral, click-worthy Pin titles and descriptions based on the source content below.

Source Title: ${sourceTitle}
Source Description: ${sourceDescription}
Trending Keywords to Integrate: ${trends.join(", ")}

Guidelines for VIRAL Success:
1. **Titles**: Must be punchy, curiosity-inducing, and keyword-rich. Use power words (e.g., "Ultimate", "Secret", "Hack", "Must-Have"). Keep them under 100 characters but maximize impact.
2. **Descriptions**: Write engaging, benefit-driven copy (150-400 characters).
   - First sentence: Hook the reader immediately with a problem or desire.
   - Middle: Explain the value/solution clearly using natural language.
   - End: Strong Call-to-Action (CTA) like "Save this for later!" or "Click to read more!".
   - Keywords: Seamlessly weave in the provided trending keywords. Do NOT stuff them; make it flow naturally.
3. **Tone**: Inspiring, helpful, and authoritative yet accessible.
4. **Formatting**: Use sentence case for descriptions. Title case for titles.

Return the result as a JSON array of objects with 'title' and 'description' fields.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
          },
          required: ["title", "description"],
        },
      },
    },
  });

  try {
    let text = response.text || "[]";
    // Clean up potential markdown code blocks if present (though responseMimeType usually handles this)
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}

export async function generatePinImage(prompt: string): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [{ text: `Create a stunning, high-converting Pinterest pin image for: ${prompt}. 
        Style: Professional, aesthetic, high-resolution photography or premium graphic design.
        Composition: Vertical (9:16), clean layout, eye-catching focal point.
        Vibe: Inspiring, aspirational, and 'save-worthy'.
        Colors: Vibrant but harmonious, on-trend palettes.` }],
      },
      config: {
        imageConfig: {
          aspectRatio: "9:16",
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image generation failed", error);
    return null;
  }
}

export async function editPinImage(base64Image: string, prompt: string): Promise<string | null> {
  try {
    // Remove data:image/png;base64, prefix if present
    const cleanBase64 = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: "image/png",
            },
          },
          { text: `Edit this image to make it more viral on Pinterest. ${prompt}. Maintain high quality and vertical aspect ratio.` },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "9:16",
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image editing failed", error);
    return null;
  }
}
