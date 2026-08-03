import type { RulesetDocument } from "./serialize";
import { RULESET_FORMAT_VERSION } from "./serialize";

/* Spec1.1 section 14. Seeded but not enabled: a schedule that starts running
   the moment the app opens would put slots on a calendar nobody asked to have
   filled. They are examples to start from, not defaults.

   Ids are stable strings rather than generated, so importing the same preset
   twice replaces it instead of stacking a second copy beside the first. */

const TZ = "Europe/Rome";

function generator(
  id: string,
  name: string,
  kind: string,
  emits: Record<string, unknown>,
  config: unknown,
  layer = 50,
): RulesetDocument["generators"][number] {
  return {
    id: `preset-${id}`,
    name,
    kind: kind as RulesetDocument["generators"][number]["kind"],
    enabled: false,
    layer,
    validFrom: null,
    validTo: null,
    timezone: TZ,
    emits: emits as RulesetDocument["generators"][number]["emits"],
    config,
  };
}

function modifier(
  id: string,
  name: string,
  kind: string,
  config: unknown,
  order = 0,
): RulesetDocument["modifiers"][number] {
  return {
    id: `preset-${id}`,
    name,
    kind: kind as RulesetDocument["modifiers"][number]["kind"],
    enabled: false,
    order,
    validFrom: null,
    validTo: null,
    timezone: TZ,
    config,
  };
}

const post = (platform: string, durationMinutes = 10): Record<string, unknown> => ({
  kind: "post",
  platform,
  category: "content",
  durationMinutes,
});

export const PRESETS: readonly RulesetDocument[] = [
  {
    format: RULESET_FORMAT_VERSION,
    name: "Creator daily",
    generators: [
      generator("creator-x", "X, four a day", "daily-times", post("x"), {
        times: ["08:00", "12:00", "18:00", "22:00"],
      }),
      generator("creator-li", "LinkedIn, one a day", "daily-times", post("linkedin", 20), {
        times: ["09:00"],
      }),
      generator("creator-reel", "Reel, one a day", "daily-times", post("instagram", 30), {
        times: ["19:00"],
      }),
    ],
    modifiers: [
      modifier("creator-sleep", "Sleep", "blackout", {
        windows: [{ range: ["23:30", "07:00"], label: "sleep" }],
        mode: "remove",
      }),
    ],
  },

  {
    format: RULESET_FORMAT_VERSION,
    name: "Build in public",
    generators: [
      generator("bip-x", "X, three on weekdays", "daily-times", post("x"), {
        times: ["09:00", "13:00", "18:00"],
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
      }),
      generator("bip-li", "LinkedIn, weekdays", "daily-times", post("linkedin", 20), {
        times: ["10:00"],
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
      }),
      generator(
        "bip-batch",
        "Sunday production",
        "batch-production",
        { kind: "focus", category: "build", durationMinutes: 180 },
        {
          perSlots: 6,
          leadDays: 2,
          durationMinutes: 180,
          preferredWeekdays: ["sun"],
          preferredTime: "14:00",
          sourceGeneratorIds: ["preset-bip-x"],
        },
        40,
      ),
      generator(
        "bip-ship",
        "Promo when something ships",
        "derived",
        post("x"),
        {
          trigger: { kind: "post", platform: "github" },
          offsets: [
            { minutes: 120, emits: { platform: "x", titleTemplate: "Shipped: {trigger.title}" } },
            { minutes: 1440, emits: { platform: "linkedin" } },
          ],
        },
        60,
      ),
    ],
    modifiers: [],
  },

  {
    format: RULESET_FORMAT_VERSION,
    name: "Student schedule",
    generators: [
      generator(
        "student-study",
        "Evening study",
        "gap-fill",
        { kind: "focus", category: "admin", durationMinutes: 60 },
        {
          budgetMinutes: 180,
          minChunkMinutes: 45,
          maxChunkMinutes: 90,
          window: ["16:00", "22:00"],
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          strategy: "largest-first",
        },
      ),
      generator(
        "student-weekend",
        "Weekend batch",
        "daily-times",
        { kind: "focus", category: "build", durationMinutes: 120 },
        { times: ["10:00"], weekdays: ["sat", "sun"] },
      ),
    ],
    modifiers: [
      modifier("student-school", "School", "blackout", {
        windows: [
          {
            weekdays: ["mon", "tue", "wed", "thu", "fri"],
            range: ["08:00", "14:00"],
            label: "school",
          },
        ],
        mode: "remove",
      }),
    ],
  },

  {
    format: RULESET_FORMAT_VERSION,
    name: "Minimal",
    generators: [
      generator("minimal-x", "One a weekday", "daily-times", post("x"), {
        times: ["09:00"],
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
      }),
    ],
    modifiers: [],
  },

  {
    format: RULESET_FORMAT_VERSION,
    name: "Agency",
    generators: [
      generator("agency-x", "X quota", "quota", post("x"), {
        count: 5,
        period: "week",
        window: ["09:00", "17:00"],
        placement: "spread-days",
      }),
      generator("agency-li", "LinkedIn quota", "quota", post("linkedin", 20), {
        count: 3,
        period: "week",
        window: ["09:00", "17:00"],
        placement: "spread-days",
      }),
      generator("agency-ig", "Instagram quota", "quota", post("instagram", 30), {
        count: 2,
        period: "week",
        window: ["11:00", "20:00"],
        placement: "spread-days",
      }),
      generator("agency-yt", "YouTube quota", "quota", post("youtube", 45), {
        count: 2,
        period: "week",
        window: ["10:00", "18:00"],
        placement: "spread-days",
      }),
    ],
    modifiers: [
      modifier("agency-spacing", "Spacing", "spacing", {
        minMinutes: 120,
        resolution: "shift-later",
        maxShiftMinutes: 120,
      }),
      modifier(
        "agency-capacity",
        "Daily cap",
        "capacity",
        { max: 4, period: "day", eviction: "drop-lowest-layer" },
        1,
      ),
    ],
  },
];

export function presetByName(name: string): RulesetDocument | null {
  return PRESETS.find((preset) => preset.name === name) ?? null;
}
