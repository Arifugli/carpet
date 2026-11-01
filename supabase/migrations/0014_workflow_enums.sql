-- Enum additions commit before migration 0015 uses them. No data is removed here.
alter type public.user_role add value if not exists 'warehouse';
alter type public.user_role add value if not exists 'washer';
alter type public.user_role add value if not exists 'packer';
alter type public.order_status add value if not exists 'pickup_planned';
alter type public.order_status add value if not exists 'warehouse';
alter type public.order_status add value if not exists 'packing';
alter type public.order_status add value if not exists 'ready_for_delivery';
alter type public.order_status add value if not exists 'in_transit';
alter type public.order_status add value if not exists 'postponed';
