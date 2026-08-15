export const APPROVED_VEHICLE_ROUTES = [
  'Stage 17 to Machakos',
  'Soweto to Utawala',
  'Rounda / Taj Mall to Utawala',
  'Cabanas to Allsops',
  'Outer Ring to Utawala',
  'Kariobangi to Kangundo',
  'Soweto to Kabanas',
  'Kabanas, Mombasa Road',
  'Junction to Mihango'
] as const;

export const VEHICLE_CAPACITIES = [7, 14, 26, 29, 46, 52, 63] as const;

export type ApprovedVehicleRoute = (typeof APPROVED_VEHICLE_ROUTES)[number];

export function isApprovedVehicleRoute(value: unknown): value is ApprovedVehicleRoute {
  return typeof value === 'string' && APPROVED_VEHICLE_ROUTES.includes(value as ApprovedVehicleRoute);
}

export function isSupportedVehicleCapacity(value: unknown): value is (typeof VEHICLE_CAPACITIES)[number] {
  return typeof value === 'number' && VEHICLE_CAPACITIES.includes(value as (typeof VEHICLE_CAPACITIES)[number]);
}
