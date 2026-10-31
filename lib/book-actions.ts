// The shape of an action arriving from a browser. Server actions are public endpoints, so nothing is assumed about the
// request: unknown fields are dropped and numbers and strings are bounded before the rules ever see them.
import { z } from "zod";
import type { BookAction } from "./book";

const id = z.string().min(1).max(120);
const text = (max = 500) => z.string().trim().max(max);
const money = z.number().finite().min(0).max(100_000_000);
const optionalMoney = money.optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const product = z.enum(["fix_flip", "bridge", "ground_up", "dscr"]);

const application = z.object({
  product,
  purpose: z.enum(["purchase", "refi_rt", "refi_co"]),
  county: text(80),
  state: text(2).min(2),
  propertyType: z.enum(["sfr", "2_4", "condo", "townhome"]),
  occupancy: z.enum(["vacant", "tenant", "owner_occupied"]),
  purchasePrice: money,
  appraisedAsIs: optionalMoney,
  rehab: money,
  arv: money,
  originalPurchasePrice: optionalMoney,
  rehabSpent: optionalMoney,
  existingLiens: optionalMoney,
  landValue: optionalMoney,
  hardCosts: optionalMoney,
  softCosts: optionalMoney,
  groundUpBuilds: z.number().int().min(0).max(1000).optional(),
  monthlyRent: optionalMoney,
  taxesAnnual: optionalMoney,
  insuranceAnnual: optionalMoney,
  hoaMonthly: optionalMoney,
  requestedAmount: optionalMoney,
  termMonths: z.number().int().min(1).max(480).optional(),
  interestReserve: z.enum(["none", "financed"]),
  accrual: z.enum(["full_boat", "dutch"]),
  fico: z.number().int().min(0).max(900),
  verifiedDeals: z.number().int().min(0).max(10_000),
  foreignNational: z.boolean().optional(),
  repeatBorrower: z.boolean().optional(),
  liquidity: money,
  earnestMoney: optionalMoney,
  valuationSource: z.enum(["appraisal", "bpo", "avm", "borrower_estimate"]).optional(),
});

const buyBox = z.object({
  products: z.array(product).max(4),
  states: z.array(text(2)).max(60),
  minLoan: money,
  maxLoan: money,
  maxLTARV: z.number().min(0).max(2).optional(),
  maxLTV: z.number().min(0).max(2).optional(),
  minFico: z.number().int().min(0).max(900),
  minTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  targetYield: z.number().min(0).max(100),
});

const schema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("submitApp"), app: application, address: text(200), city: text(100), zip: text(10), entityName: text(200), exitStrategy: text(40), client: z.object({ name: text(120), borrowerId: id.optional(), brokerId: id.optional(), brokerPoints: z.number().min(0).max(5).optional() }).optional(), source: text(40).optional() }),
  z.object({ t: z.literal("advanceLoan"), dealId: id }),
  z.object({ t: z.literal("approveFunding"), dealId: id, by: text(120) }),
  z.object({ t: z.literal("updateDealNumbers"), dealId: id, changes: application.partial() }),
  z.object({ t: z.literal("addDocRequest"), dealId: id, name: text(200).min(1), category: text(60).min(1) }),
  z.object({ t: z.literal("saveSource"), source: z.object({ id, name: text(120).min(1), type: z.enum(["gt_balance_sheet", "gt_credit_line", "partner_lender"]), commitment: money, baseDeployed: money, baseUnfunded: money, lineUndrawn: optionalMoney }) }),
  z.object({ t: z.literal("removeSource"), id }),
  z.object({ t: z.literal("saveFirm"), kind: z.enum(["partner", "buyer"]), id, name: text(120).min(1), buyBox }),
  z.object({ t: z.literal("docStatus"), dealId: id, docId: id, status: z.enum(["requested", "uploaded", "in_review", "accepted", "rejected", "waived"]) }),
  z.object({ t: z.literal("route"), dealId: id, route: z.enum(["in_house", "partner", "split"]), inHouseAmount: money }),
  z.object({ t: z.literal("sendTeaser"), dealId: id, partnerIds: z.array(id).min(1).max(50) }),
  z.object({ t: z.literal("bid"), bid: z.object({ dealId: id, partnerId: z.string().max(120), pct: z.number().min(1).max(100), lenderRate: z.number().min(0).max(100), lenderPoints: z.number().min(0).max(20), conditions: text(500), type: z.enum(["bid", "accept_as_offered"]) }) }),
  z.object({ t: z.literal("acceptBid"), bidId: id }),
  z.object({ t: z.literal("commit"), dealId: id }),
  z.object({ t: z.literal("signNda"), partnerId: z.string().max(120) }),
  z.object({ t: z.literal("signBuyerNda"), buyerId: z.string().max(120) }),
  z.object({ t: z.literal("listLoan"), dealId: id, askPct: z.number().min(50).max(120) }),
  z.object({ t: z.literal("unlistLoan"), saleId: id }),
  z.object({ t: z.literal("offerLoan"), saleId: id, buyerId: z.string().max(120), pricePct: z.number().min(50).max(120), note: text(500), atAsk: z.boolean() }),
  z.object({ t: z.literal("decideOffer"), offerId: id, accept: z.boolean() }),
  z.object({ t: z.literal("acceptTermSheet"), dealId: id, signedName: text(120).min(1) }),
  z.object({ t: z.literal("saveScope"), dealId: id, scope: z.array(z.object({ id, division: text(120), budget: money, released: money })).max(60), summary: text(4000) }),
  z.object({ t: z.literal("requestDraw"), dealId: id, by: z.string().max(120), note: text(2000), contact: text(200).min(1), photos: z.array(text(200)).max(30), photoIds: z.array(id).max(30).optional(), lines: z.array(z.object({ scopeId: id, requested: money })).max(60) }),
  z.object({ t: z.literal("sendInspector"), drawId: id }),
  z.object({ t: z.literal("recordInspection"), drawId: id, observed: z.record(z.string().max(120), z.number().min(0).max(1)) }),
  z.object({ t: z.literal("approveDrawRequest"), drawId: id, by: z.string().max(120) }),
  z.object({ t: z.literal("rejectDraw"), drawId: id, reason: text(500).min(1) }),
  z.object({ t: z.literal("releaseDraw"), drawId: id }),
  z.object({ t: z.literal("recordPayment"), dealId: id }),
  z.object({ t: z.literal("requestPayoff"), dealId: id, goodThrough: date, by: z.string().max(120) }),
  z.object({ t: z.literal("sendPayoff"), payoffId: id }),
  z.object({ t: z.literal("markPaidOff"), payoffId: id }),
  z.object({ t: z.literal("sendMessage"), dealId: id, from: z.string().max(120), side: z.enum(["team", "borrower", "broker", "internal"]), text: text(4000).min(1) }),
]);

/** The action if it is well formed, or null. uploadDoc and linkBorrower aren't here: only the server starts those. */
export function parseAction(raw: unknown): BookAction | null {
  const parsed = schema.safeParse(raw);
  return parsed.success ? (parsed.data as BookAction) : null;
}
