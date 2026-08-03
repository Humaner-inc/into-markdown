import type { PageCategory } from "./types.js";

type Rule = {
  category: PageCategory;
  patterns: RegExp[];
};

const RULES: Rule[] = [
  {
    category: "Pricing",
    patterns: [
      /\/pricing/i,
      /\/plans?/i,
      /\/billing/i,
      /\/subscribe/i,
      /\/checkout/i,
    ],
  },
  {
    category: "Docs",
    patterns: [
      /\/docs?(?:\/|$)/i,
      /\/documentation/i,
      /\/help(?:\/|$)/i,
      /\/support(?:\/|$)/i,
      /\/guides?(?:\/|$)/i,
      /\/api(?:\/|$)/i,
      /\/reference(?:\/|$)/i,
      /\/changelog/i,
      /\/developers?(?:\/|$)/i,
    ],
  },
  {
    category: "Blog",
    patterns: [
      /\/blog(?:\/|$)/i,
      /\/news(?:\/|$)/i,
      /\/articles?(?:\/|$)/i,
      /\/posts?(?:\/|$)/i,
      /\/resources?(?:\/|$)/i,
      /\/press(?:\/|$)/i,
    ],
  },
  {
    category: "Careers",
    patterns: [
      /\/careers?(?:\/|$)/i,
      /\/jobs?(?:\/|$)/i,
      /\/hiring/i,
      /\/join(?:-us)?(?:\/|$)/i,
    ],
  },
  {
    category: "Legal",
    patterns: [
      /\/privacy/i,
      /\/terms/i,
      /\/legal/i,
      /\/cookies?/i,
      /\/dpa/i,
      /\/gdpr/i,
      /\/security/i,
      /\/trust/i,
      /\/sla/i,
      /\/aup/i,
    ],
  },
  {
    category: "Company",
    patterns: [
      /\/about/i,
      /\/company/i,
      /\/team/i,
      /\/story/i,
      /\/mission/i,
      /\/contact/i,
      /\/investors?/i,
    ],
  },
  {
    category: "Product",
    patterns: [
      /\/product/i,
      /\/features?/i,
      /\/solutions?/i,
      /\/platform/i,
      /\/use-cases?/i,
      /\/integrations?/i,
      /\/customers?/i,
      /\/demo/i,
      /\/how-it-works/i,
    ],
  },
];

export function categorizeUrl(pageUrl: string, rootUrl: string): PageCategory {
  let path = "/";
  try {
    const page = new URL(pageUrl);
    const root = new URL(rootUrl);
    path = page.pathname || "/";
    const rootPath =
      root.pathname === "/" ? "/" : root.pathname.replace(/\/$/, "");
    if (path === "/" || path === rootPath || path === `${rootPath}/`) {
      return "Home";
    }
  } catch {
    return "Other";
  }

  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(path))) {
      return rule.category;
    }
  }

  return "Other";
}

export function categoryAnchor(category: PageCategory): string {
  return category.toLowerCase();
}
