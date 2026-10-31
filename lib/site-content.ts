// Copy for the public site's program and investor guide pages, carried over from the LendHous marketing site.

export type Program = {
  slug: string;
  eyebrow: string;
  title: string;
  summary: string;
  /** The shorter line on the landing page. */
  homeSummary: string;
  audience: string;
  structure: string;
  prepare: string[];
  consider: string;
};

export const PROGRAMS: Program[] = [
  {
    slug: "fix-flip",
    eyebrow: "CREATE VALUE",
    title: "Fix & flip",
    summary: "Short-term financing for the purchase and renovation of an investment property, with a sale or refinance as the planned exit.",
    homeSummary: "Purchase and renovate an investment property, with a sale or refinance in mind.",
    audience: "Investors renovating a property before resale or stabilization.",
    structure: "Acquisition financing with a renovation budget that may be released through approved draws. Interest, fees, inspections, reserves, and the maturity date should all be reflected in your project budget.",
    prepare: ["Purchase contract and property details", "Itemized scope of work, contractor estimates, and timeline", "Comparable sales and estimated after-repair value", "Borrower experience, liquidity, and sale or refinance plan"],
    consider: "Renovation overruns, longer marketing periods, and lower resale values can change your return. Set aside a contingency and a credible backup exit.",
  },
  {
    slug: "dscr",
    eyebrow: "HOLD FOR THE LONG TERM",
    title: "DSCR rental",
    summary: "Investment property financing where rental income is central to evaluating the property’s ability to support its debt.",
    homeSummary: "Financing centered on rental income for investors taking the longer view.",
    audience: "Investors purchasing or refinancing income-producing rental properties.",
    structure: "A rental-focused loan may offer amortizing or interest-only payment structures, depending on eligibility. Compare the full payment, reserves, prepayment provisions, and long-term operating costs.",
    prepare: ["Lease or market-rent evidence", "Property taxes, insurance, and association dues", "Property valuation and condition", "Borrower credit, entity information, reserves, and existing liens"],
    consider: "A coverage ratio is not the same as net cash flow. Maintenance, vacancy, management, and capital expenditures still affect investment performance.",
  },
  {
    slug: "bridge",
    eyebrow: "CONNECT THE NEXT OPPORTUNITY",
    title: "Bridge financing",
    summary: "Short-term financing for an acquisition, transition, or refinance while you execute a clearly defined property strategy.",
    homeSummary: "Short-term financing for a property acquisition or transition, with a defined exit.",
    audience: "Investors with a near-term property opportunity and a realistic repayment plan.",
    structure: "A temporary capital solution with a specified maturity. Review interest accrual, extension provisions, closing expenses, and whether renovation funding is included.",
    prepare: ["Current property value and purchase or refinance details", "Sources and uses of funds", "Property business plan and expected milestones", "Documented exit strategy and available reserves"],
    consider: "Refinancing and a timely sale are not guaranteed. Evaluate what happens if market conditions or your project timeline change.",
  },
  {
    slug: "construction",
    eyebrow: "BUILD FROM THE GROUND UP",
    title: "Ground-up construction",
    summary: "Explore a financing structure for a new residential investment project, from land and plans to completed property.",
    homeSummary: "A new residential investment project, from land and plans to completed property.",
    audience: "Builders with a defined scope, construction team, and development timeline.",
    structure: "Construction funding generally follows a budget and a schedule of draws tied to progress. Land basis, permits, contingency, inspections, and completion risk matter.",
    prepare: ["Land ownership or acquisition details", "Plans, permits, budget, and schedule", "General contractor qualifications and agreements", "Completed-value support and sale or rental strategy"],
    consider: "Program availability and experience requirements need to be confirmed. Permit delays and cost escalation can materially affect a project.",
  },
  {
    slug: "portfolio",
    eyebrow: "THINK BEYOND ONE PROPERTY",
    title: "Rental portfolio",
    summary: "Evaluate financing across multiple investment properties with a consistent view of rent, expenses, debt, and your long-term plan.",
    homeSummary: "Financing across multiple investment properties, with one view of rent, expenses, and debt.",
    audience: "Investors managing or acquiring multiple income-producing properties.",
    structure: "Review whether separate loans or a combined structure fit your goals. Cross-collateralization, release provisions, and individual property performance need careful attention.",
    prepare: ["Property schedule and ownership entities", "Rent roll, leases, and operating expenses", "Existing loans and maturity dates", "Portfolio valuation, reserves, and acquisition plans"],
    consider: "Confirm eligibility and collateral requirements. A combined structure may affect your ability to sell or refinance individual properties.",
  },
];

export type Guide = {
  slug: string;
  eyebrow: string;
  title: string;
  summary: string;
  sections: { heading: string; body: string }[];
  further?: { href: string; label: string; note: string };
};

export const GUIDES: Guide[] = [
  {
    slug: "first-investment",
    eyebrow: "START HERE",
    title: "Your first investment, with a clearer plan.",
    summary: "A strong financing conversation starts with a complete picture of the property and the project.",
    sections: [
      { heading: "Start with the exit", body: "Decide whether you intend to sell, rent, or refinance. Each strategy changes the budget, timeline, and financing questions. Build a second scenario for a slower sale or delayed refinance." },
      { heading: "Build the whole budget", body: "Include acquisition, renovation, contingency, financing, insurance, taxes, utilities, and selling costs. Separate the cash needed at closing from funds you will need later." },
      { heading: "Prepare the essentials", body: "Organize the purchase contract, property information, entity documents, scope of work, contractor bids, and liquidity evidence. Requirements vary by program; send sensitive documents only through an approved secure channel." },
      { heading: "Ask useful questions", body: "Ask how interest is charged, how draws are released, whether there are minimum-interest or prepayment provisions, and what happens at maturity. Review written terms before committing." },
    ],
  },
  {
    slug: "leverage",
    eyebrow: "FINANCING FUNDAMENTALS",
    title: "LTC, LTV, and ARV: know your numbers.",
    summary: "These ratios measure different things. A high limit on one ratio does not override a lower limit on another.",
    sections: [
      { heading: "Loan-to-cost (LTC)", body: "Loan amount divided by eligible project cost. Eligible cost may include acquisition and approved renovation expenses; the lender determines which items count." },
      { heading: "Loan-to-value (LTV)", body: "Loan amount divided by the lender’s accepted property value. Confirm whether value means as-is value or another basis." },
      { heading: "After-repair value (ARV)", body: "An estimate of the property’s value after planned work is complete. It is not a guaranteed sale price. A loan-to-ARV limit uses this future value as its denominator." },
      { heading: "Use the tighter constraint", body: "For a hypothetical $300,000 eligible cost and $350,000 accepted value, 95% LTC implies $285,000, while 75% LTV implies $262,500. If both caps apply, the lower amount controls before other underwriting limits and fees." },
    ],
  },
  {
    slug: "dscr-explained",
    eyebrow: "RENTAL INVESTING",
    title: "What rental coverage really tells you.",
    summary: "Debt-service coverage is a useful starting point, but a rental property deserves a broader cash-flow review.",
    sections: [
      { heading: "The residential rental convention", body: "This site’s calculator divides monthly rent by principal, interest, taxes, insurance, and association dues (PITIA). At $3,000 rent and $2,400 PITIA, the ratio is 1.25x." },
      { heading: "Know which formula applies", body: "Some commercial loans use net operating income divided by debt service. That is a different calculation. The lender’s program determines the applicable definition and qualifying income." },
      { heading: "Separate coverage from profit", body: "Rent above PITIA does not account for vacancy, repairs, capital reserves, or management. Include those expenses in a separate cash-flow analysis." },
      { heading: "Underwriting is broader than a ratio", body: "Property eligibility, credit, reserves, valuation, rental evidence, and program rules can all matter. Calculator results do not establish approval or program eligibility." },
    ],
    further: { href: "https://www.totalqualitylending.com/resources/guides/dscr-ratio-calculation", label: "Residential DSCR calculation explained", note: "That lender’s eligibility criteria are not LendHous terms." },
  },
  {
    slug: "draws",
    eyebrow: "PROJECT EXECUTION",
    title: "Plan your renovation draws before work begins.",
    summary: "A renovation budget and a draw process should work together, so you can plan the cash needed between milestones.",
    sections: [
      { heading: "Define the work", body: "Break the scope into clearly priced stages and align it with contractor agreements. Track the original budget, approved changes, and remaining contingency." },
      { heading: "Understand reimbursements", body: "Ask which expenses are eligible, whether work must be completed before reimbursement, and what inspections, invoices, or lien documentation are needed." },
      { heading: "Allow for review time", body: "A request does not guarantee immediate release. Keep working capital for contractor payments, inspections, and corrections while a draw is reviewed." },
      { heading: "Keep the record current", body: "Save invoices and progress evidence, reconcile funded draws to remaining funds, and communicate scope changes before incurring costs." },
    ],
  },
  {
    slug: "interest-only",
    eyebrow: "LOAN STRUCTURES",
    title: "Interest-only payments: the full picture.",
    summary: "A lower scheduled payment during an interest-only period does not mean the principal balance is being repaid.",
    sections: [
      { heading: "How the estimate works", body: "A simple monthly illustration is outstanding principal × annual interest rate ÷ 12. Actual loan documents may use daily accrual, different day-count conventions, minimum interest, or interest on undrawn funds." },
      { heading: "Principal remains due", body: "Scheduled interest-only payments do not reduce principal. The remaining balance must be repaid, refinanced, or amortized according to the loan agreement." },
      { heading: "Budget beyond interest", body: "Taxes, insurance, dues, maintenance, and fees can still be payable. Read the maturity, extension, default, and prepayment provisions." },
      { heading: "Stress-test the exit", body: "Consider a longer hold, lower property value, or higher refinance payment. Neither a sale nor a refinance is assured." },
    ],
    further: { href: "https://www.consumerfinance.gov/ask-cfpb/what-is-an-interest-only-loan-en-101/", label: "CFPB explanation of interest-only loan mechanics", note: "Consumer mortgage rules are not represented here as rules for a business-purpose loan." },
  },
];

export const FAQS = [
  { question: "Can I explore financing as a first-time investor?", answer: "Yes. First-time investors are welcome to discuss their project. Eligibility depends on the program, property, financial profile, and underwriting." },
  { question: "Are the maximum leverage figures guaranteed?", answer: "No. Up to 95% LTC and up to 75% LTV are owner-supplied maximums, not a quote. They may apply to different programs and may not be available together." },
  { question: "Where does LendHous lend?", answer: "Location and licensing eligibility must be confirmed directly with LendHous before an application. No nationwide availability is represented here." },
  { question: "How quickly can a loan close?", answer: "A timeline depends on underwriting, valuation, title, documentation, and closing conditions. This site does not promise a fixed closing time." },
];
