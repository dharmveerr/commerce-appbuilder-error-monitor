import { defineConfig } from '@adobe/aio-commerce-lib-app/config';

// Real Commerce flow for the Error Monitor demo: a cart webhook and an order event, both reporting through the SDK.
const cartFields = ['sku', 'qty', 'quote_id'].map((name) => ({ name, source: `data.quote_item.${name}` }));

export default defineConfig({
  metadata: {
    id: 'error-monitor-sample',
    displayName: 'Error Monitor Sample',
    description: 'Sample app that reports webhook and event-handler errors to the Error Monitor.',
    version: '0.1.0',
  },
  webhooks: [
    {
      label: 'Sample cart check',
      description: 'Checks each item added to the cart; reports unexpected failures to the Error Monitor.',
      category: 'validation',
      runtimeAction: 'sample-consumer/validate-cart',
      webhook: {
        webhook_method: 'observer.sales_quote_add_item',
        webhook_type: 'before',
        batch_name: 'error_monitor_sample',
        hook_name: 'validate_cart',
        method: 'POST',
        required: false,
        timeout: 5000,
        soft_timeout: 3000,
        fallback_error_message: 'We could not check your cart right now. Please try again.',
        fields: cartFields,
      },
    },
  ],
  eventing: {
    commerce: [
      {
        provider: {
          label: 'Error Monitor Sample events',
          description: 'Commerce order events for the Error Monitor sample app.',
        },
        events: [
          {
            name: 'plugin.sales.api.order_management.place',
            label: 'Order placed',
            description: 'Sends each placed order to the sample order sync.',
            fields: [{ name: '*' }],
            runtimeActions: ['sample-consumer/order-placed'],
          },
        ],
      },
    ],
  },
});
