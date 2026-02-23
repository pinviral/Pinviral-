import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
  
  const prompt = `Based on the following content:
Title: ${sourceTitle}
Description: ${sourceDescription}

Generate 5 unique Pinterest pin titles and descriptions that are catchy and include these trending keywords if relevant: ${trends.join(", ")}.
Each description should be 150-300 characters, SEO-rich, and include a call-to-action.

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
    return JSON.parse(response.text || "[]");
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
        parts: [{ text: `A high-quality, aesthetic Pinterest pin image for: ${prompt}. Professional photography style, clean composition, vibrant colors.` }],
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
          { text: prompt },
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
