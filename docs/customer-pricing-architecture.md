# Customer Pricing Architecture

## Mermaid Diagram

```mermaid
flowchart TD
    U[User]

    subgraph Web["Web App"]
        APP[apps/web/src/App.jsx]
        APIJS[apps/web/src/api.js]
        PT[PriceTablesPage.jsx]
        MP[MobilePricesPage.jsx]
        CSS[styles.css]
    end

    subgraph Api["API"]
        SERVER[apps/api/src/server.js]
        ENGINE[apps/api/src/pricing/engine.js]
        REPO[apps/api/src/pricing/repositories.js]
        DBJS[apps/api/src/db.js]
        WB[applyWorkbookPricingTestData.js]
        SEED[seed.js]
    end

    subgraph Db["PostgreSQL"]
        CUST[(customers)]
        CONTACTS[(customer_contacts)]
        PROFILES[(customer_pricing_profiles)]
        SOURCES[(pricing_source_snapshots)]
        VALUES[(pricing_source_values)]
        TAXES[(pricing_tax_schedules)]
        RULES[(pricing_rule_sets)]
        COMPONENTS[(pricing_rule_components)]
        VENDORSETS[(pricing_rule_vendor_sets)]
        OUTPUTS[(generated_customer_prices)]
        EXPORTS[(pricing_export_templates / pricing_export_jobs)]
    end

    U --> APP
    APP --> PT
    APP --> MP
    PT --> APIJS
    MP --> APIJS
    PT -. styling .-> CSS
    MP -. styling .-> CSS

    APIJS --> SERVER

    SERVER --> REPO
    SERVER --> ENGINE
    ENGINE --> REPO
    REPO --> DBJS

    DBJS --> CUST
    DBJS --> CONTACTS
    DBJS --> PROFILES
    DBJS --> SOURCES
    DBJS --> VALUES
    DBJS --> TAXES
    DBJS --> RULES
    DBJS --> COMPONENTS
    DBJS --> VENDORSETS
    DBJS --> OUTPUTS
    DBJS --> EXPORTS

    SEED --> DBJS
    WB --> DBJS
    WB --> SOURCES
    WB --> VALUES
    WB --> TAXES
    WB --> RULES
    WB --> COMPONENTS
    WB --> VENDORSETS
    WB --> CUST
    WB --> PROFILES
```

## Notes

- `Price Tables` is the admin workspace for pricing rules, inputs, previews, run history, outputs, and OPIS/source review.
- `Mobile Prices` is a mobile-first prototype using the same pricing backend and generated output records.
- `server.js` exposes the pricing HTTP routes and delegates persistence to `repositories.js` and evaluation/generation to `engine.js`.
- `engine.js` resolves the active customer profile, source snapshots, source values, taxes, and rules, then computes preview or generated outputs.
- `repositories.js` owns CRUD and query access for customers, pricing sources, taxes, rules, and generated prices.
- `db.js` creates the pricing tables and indexes during API startup or seed execution.
- `applyWorkbookPricingTestData.js` seeds deterministic pricing snapshots, values, customer profiles, taxes, and rule sets for local testing.
