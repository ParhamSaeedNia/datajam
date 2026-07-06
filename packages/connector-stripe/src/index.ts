import Stripe from "stripe";
import type {
  ConnectorResourceSyncResult,
  SourceConnector,
  StripeResourceName,
  SyncContext
} from "@datajam/types";

export interface StripeConnectorOptions {
  apiKey: string;
}

type StripeListResult = {
  data: Array<Record<string, unknown>>;
  has_more: boolean;
};

export class StripeConnector implements SourceConnector {
  public readonly source = "stripe" as const;
  private readonly client: Stripe;

  public constructor(options: StripeConnectorOptions) {
    this.client = new Stripe(options.apiKey, {
      appInfo: {
        name: "datajam",
        version: "0.1.0"
      }
    });
  }

  public async validateConnection(): Promise<void> {
    await this.client.balance.retrieve();
  }

  public listSupportedResources(): StripeResourceName[] {
    return [
      "customers",
      "products",
      "prices",
      "subscriptions",
      "invoices",
      "charges",
      "refunds",
      "payment_intents",
      "checkout_sessions",
      "balance_transactions",
      "disputes",
      "payouts",
      "transfers"
    ];
  }

  public async *syncResource(
    resource: StripeResourceName,
    context: SyncContext
  ): AsyncGenerator<ConnectorResourceSyncResult<unknown>> {
    const checkpoint = context.mode === "incremental" ? await context.storage.getCheckpoint(resource) : null;
    let page = 0;
    let cursor: string | undefined = checkpoint?.lastCursor ?? undefined;
    let hasMore = true;

    while (hasMore) {
      page += 1;
      const response = await context.retry.execute(
        async () => this.fetchResourcePage(resource, cursor, checkpoint?.lastCreated),
        { resource, page }
      );

      const data = response.data;
      hasMore = response.has_more;
      cursor = data.length > 0 ? String(data[data.length - 1]?.id ?? "") : undefined;
      const maxCreated = this.findMaxCreated(data);

      yield {
        resource,
        records: data,
        page,
        hasMore,
        nextCursor: cursor ?? null,
        maxCreated
      };

      if (!hasMore) {
        return;
      }
    }
  }

  private async fetchResourcePage(
    resource: StripeResourceName,
    cursor?: string,
    lastCreated?: number | null
  ): Promise<StripeListResult> {
    const baseParams: Record<string, unknown> = {
      limit: 100,
      starting_after: cursor
    };
    if (typeof lastCreated === "number" && lastCreated > 0) {
      baseParams.created = { gt: lastCreated };
    }

    const cleanParams = Object.fromEntries(
      Object.entries(baseParams).filter(([, value]) => value !== undefined && value !== null && value !== "")
    );

    switch (resource) {
      case "customers":
        return (await this.client.customers.list(cleanParams)) as unknown as StripeListResult;
      case "products":
        return (await this.client.products.list(cleanParams)) as unknown as StripeListResult;
      case "prices":
        return (await this.client.prices.list(cleanParams)) as unknown as StripeListResult;
      case "subscriptions":
        return (await this.client.subscriptions.list(cleanParams)) as unknown as StripeListResult;
      case "invoices":
        return (await this.client.invoices.list(cleanParams)) as unknown as StripeListResult;
      case "charges":
        return (await this.client.charges.list(cleanParams)) as unknown as StripeListResult;
      case "refunds":
        return (await this.client.refunds.list(cleanParams)) as unknown as StripeListResult;
      case "payment_intents":
        return (await this.client.paymentIntents.list(cleanParams)) as unknown as StripeListResult;
      case "checkout_sessions":
        return (await this.client.checkout.sessions.list(cleanParams)) as unknown as StripeListResult;
      case "balance_transactions":
        return (await this.client.balanceTransactions.list(cleanParams)) as unknown as StripeListResult;
      case "disputes":
        return (await this.client.disputes.list(cleanParams)) as unknown as StripeListResult;
      case "payouts":
        return (await this.client.payouts.list(cleanParams)) as unknown as StripeListResult;
      case "transfers":
        return (await this.client.transfers.list(cleanParams)) as unknown as StripeListResult;
      default: {
        const neverResource: never = resource;
        throw new Error(`Unsupported resource: ${String(neverResource)}`);
      }
    }
  }

  private findMaxCreated(data: Array<Record<string, unknown>>): number | null {
    let maxCreated: number | null = null;
    for (const item of data) {
      const created = item.created;
      if (typeof created === "number" && (maxCreated === null || created > maxCreated)) {
        maxCreated = created;
      }
    }
    return maxCreated;
  }
}
