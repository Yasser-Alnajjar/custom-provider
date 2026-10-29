import type { Author, EventType, Person, Ticket } from "./types";

// Pure, deterministic synthetic ticket builder. The same (seq, seed, anchor, index)
// always yields the same ticket, so a retried batch can never produce different data.

export const SYNTHETIC_TAG = "synthetic";
export const SYNTHETIC_EMAIL_DOMAIN = "synthetic.invalid"; // .invalid is reserved: never a real mailbox
export const ticketIdPrefix = (seq: number) => `SYN-${seq}-`;
export const jobTag = (seq: number) => `synthetic-job-${seq}`;
export const isSyntheticTicket = (t: Pick<Ticket, "id" | "tags">) =>
  t.id.startsWith("SYN-") && t.tags.includes(SYNTHETIC_TAG);

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function mulberry32(seed: number) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;

    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
function weighted<T>(r: Rng, list: readonly (readonly [T, number])[]): T {
  let n = r() * list.reduce((sum, [, w]) => sum + w, 0);

  for (const [v, w] of list) if ((n -= w) < 0) return v;
  return list[0][0];
}

const FIRST = ["Mona", "Omar", "Layla", "Yusuf", "Nora", "Samir", "Hana", "Karim", "Dina", "Tariq", "Rania", "Faris"];
const LAST = ["Haddad", "Nasser", "Khalil", "Mansour", "Saleh", "Aziz", "Farah", "Darwish", "Qasim", "Jaber"];
const CUSTOMERS = ["Northwind Traders", "Globex Logistics", "Initech Labs", "Umbrella Retail", "Hooli Cloud", "Stark Freight", "Wayne Health", "Wonka Foods"];
const AGENTS = ["Alex Rivera", "Sam Okafor", "Jordan Lee", "Priya Nair", "Chris Tan", "Maya Cohen"];
const CHANNELS = ["email", "chat", "web"] as const;
const EXTRA_TAGS = ["billing", "login", "bug", "feature-request", "hardware", "onboarding", "integration", "performance"];

const SUBJECTS: readonly (readonly [string, string])[] = [
  ["Cannot log in after password reset", "I reset my password but the login page keeps rejecting the new one."],
  ["Invoice total does not match the quote", "The invoice for last month is higher than the quote we agreed on."],
  ["Export to CSV times out", "Exporting the report with more than a few thousand rows fails after 30 seconds."],
  ["Webhook deliveries are delayed", "Events reach our endpoint several minutes late since yesterday."],
  ["Request: bulk edit for tags", "We would like to change the tags on many items at once instead of one by one."],
  ["Dashboard shows stale numbers", "The overview numbers have not changed since this morning."],
  ["Printer in the front office is offline", "The shared printer is showing as offline for everyone on the floor."],
  ["Need help setting up SSO", "We want to enable single sign-on for our team and are not sure where to start."],
  ["Mobile app crashes on startup", "After the latest update the app closes immediately after the splash screen."],
  ["Wrong timezone on scheduled reports", "Scheduled reports arrive one hour earlier than configured."],
];

const REPLIES = [
  "Thanks for reaching out. I am looking into this now.",
  "I could reproduce the problem and I am working on a fix.",
  "Could you share a screenshot or the exact steps that lead to this?",
  "A change has been applied on our side. Please try again and let us know.",
];
const NOTES = ["Checked the logs, nothing unusual.", "Escalated to the platform team.", "Matches a known issue from last week."];
const FOLLOW_UPS = ["Still seeing the same behaviour.", "Thanks, that helped a lot.", "Any update on this?"];

const FINAL_STATUS = [["new", 8], ["open", 15], ["in_progress", 15], ["pending", 12], ["solved", 25], ["closed", 25]] as const;
const PATH: Record<string, readonly string[]> = {
  new: [],
  open: ["open"],
  in_progress: ["open", "in_progress"],
  pending: ["open", "pending"],
  solved: ["open", "in_progress", "solved"],
  closed: ["open", "in_progress", "solved", "closed"],
};

export interface PlannedEvent {
  type: EventType;
  at: number;
  author: Author;
  public: boolean;
  body: string;
  from?: string;
  to?: string;
}

export interface PlannedTicket {
  ticket: Ticket;
  events: PlannedEvent[];
}

export interface PlanInput {
  seq: number;
  seed: number;
  anchor: number;
  index: number;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Builds ticket `index` of a job with a full, chronologically consistent history. */
export function planTicket({ seq, seed, anchor, index }: PlanInput): PlannedTicket {
  const r = mulberry32((seed ^ Math.imul(index + 1, 2654435761)) >>> 0);
  const id = `${ticketIdPrefix(seq)}${String(index + 1).padStart(5, "0")}`;

  const [subject, detail] = pick(r, SUBJECTS);
  const first = pick(r, FIRST);
  const last = pick(r, LAST);
  const requester: Person = {
    id: `syn-usr-${slug(first)}-${slug(last)}`,
    name: `${first} ${last}`,
    email: `${slug(first)}.${slug(last)}@${SYNTHETIC_EMAIL_DOMAIN}`,
  };
  const customerNo = int(r, 0, CUSTOMERS.length - 1);
  const customer: Person = { id: `syn-cus-${customerNo + 1}`, name: `${CUSTOMERS[customerNo]} (synthetic)` };
  const agentNo = int(r, 0, AGENTS.length - 1);
  const agent: Person = { id: `syn-agent-${agentNo + 1}`, name: `${AGENTS[agentNo]} (synthetic)` };
  const agentAuthor: Author = { id: agent.id!, name: agent.name!, role: "agent" };
  const customerAuthor: Author = { id: requester.id!, name: requester.name!, role: "customer" };

  const status = weighted(r, FINAL_STATUS);
  const path = PATH[status];
  const description = `${detail}\n\n[Synthetic ticket generated by job ${seq}; not real customer data.]`;

  // 10 to 60 days before the anchor, so even a long history ends before "now".
  const createdAt = anchor - 10 * DAY - Math.floor(r() * 50 * DAY);
  const events: PlannedEvent[] = [
    { type: "created", at: createdAt, author: customerAuthor, public: true, body: "Ticket created" },
    { type: "comment", at: createdAt + 1, author: customerAuthor, public: true, body: description },
  ];

  let t = createdAt;
  let resolvedAt: string | null = null;
  let from = "new";

  path.forEach((to, i) => {
    t += int(r, 5 * MIN, 8 * HOUR);
    events.push({ type: "status_changed", at: t, author: agentAuthor, public: false, from, to, body: `Status changed from ${from} to ${to}` });
    if (["solved", "closed"].includes(to)) resolvedAt ??= new Date(t).toISOString();
    from = to;

    if (i === 0) {
      // First public agent reply shortly after the ticket is picked up.
      events.push({ type: "comment", at: t + int(r, MIN, 30 * MIN), author: agentAuthor, public: true, body: pick(r, REPLIES) });
    }
    if (to === "in_progress" || to === "pending") {
      if (r() < 0.6) events.push({ type: "comment", at: t + int(r, MIN, 20 * MIN), author: agentAuthor, public: false, body: pick(r, NOTES) });
      if (r() < 0.5) events.push({ type: "comment", at: t + int(r, 30 * MIN, 4 * HOUR), author: customerAuthor, public: true, body: pick(r, FOLLOW_UPS) });
    }
  });

  events.sort((a, b) => a.at - b.at);

  const channel = pick(r, CHANNELS);
  const tags = [SYNTHETIC_TAG, jobTag(seq), channel, ...new Set([pick(r, EXTRA_TAGS), pick(r, EXTRA_TAGS)])];
  const last_at = events[events.length - 1].at;

  return {
    ticket: {
      id,
      title: `[SYNTHETIC] ${subject}`,
      description,
      status,
      priority: weighted(r, [["low", 20], ["normal", 50], ["high", 22], ["urgent", 8]] as const),
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(last_at).toISOString(),
      resolved_at: resolvedAt,
      requester,
      customer,
      assignee: status === "new" ? null : agent,
      tags,
      channel,
      url: null,
    },
    events,
  };
}
