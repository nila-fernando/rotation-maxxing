// Ask Manami's tools. They run in the browser (where the farm lives); the server only declares them.
// Built once and frozen: the order never changes (it is part of the cached prefix).

const EMPTY = { type: 'object', additionalProperties: false, required: [], properties: {} };

export const CHAT_TOOLS = Object.freeze([
  {
    name: 'get_farm_overview',
    description: 'The whole farm as it is right now: every field with its status, last crop and flags, the farmer\'s priorities and excluded crops, and whether plans exist. Call it when the farmer asks about the farm as a whole, or when something may have changed since farm_context.',
    input_schema: EMPTY,
    strict: true,
  },
  {
    name: 'get_field',
    description: 'One field\'s check-up: crops by year 2018 to 2025, soil texture and drainage, organic matter, water holding, slope and erosion risk, rain against normal, flags, irrigation and its jar test. Call it before you say anything specific about a field.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['field_id'],
      properties: { field_id: { type: 'string', description: 'The field id from farm_context.' } },
    },
    strict: true,
  },
  {
    name: 'get_plans',
    description: 'The planner\'s three plans (Keep going, Most profit, Manami’s pick) for the next three seasons: totals, each field\'s crops by season, and the crop prices they were worked out with and where those prices come from (USDA NASS, or stand-ins when NASS could not be reached). Says ready: false when the farmer has not opened "Plan my next seasons" yet. Call it for any question about the plans or what to grow next.',
    input_schema: EMPTY,
    strict: true,
  },
]);

export const CHAT_TOOL_NAMES = CHAT_TOOLS.map((t) => t.name);
