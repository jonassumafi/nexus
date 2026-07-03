const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateMissionSummary(missions, logs) {
  const n = missions.length;
  const totalRp = logs.reduce((sum, l) => sum + (l.points || 0), 0);

  const prompt = `Nexus 1.0 has seen ${n} missions over the past 5 days for a total of ${totalRp} RP points.

Produce:
1) One-line headline
2) Short paragraph max 2 sentences
3) Three bullet highlights each under 140 chars

Censor offensive content. Do not invent facts.

Mission data:
${missions.map((m) => `- [${m.mission_type}] ${m.name}: ${m.objectives || 'No objectives'}`).join('\n')}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 350,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.choices[0].message.content;
}

module.exports = { generateMissionSummary };
