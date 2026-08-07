export const APPROVED_VEHICLE_ROUTES = [
  'Stage 17 to Machakos',
  'Soweto to Utawala',
  'Rounda / Taj Mall to Utawala',
  'Cabanas to Allsops',
  'Outer Ring to Utawala',
  'Kariobangi to Kangundo'
] as const;

export type ApprovedVehicleRoute = (typeof APPROVED_VEHICLE_ROUTES)[number];

export function isApprovedVehicleRoute(value: unknown): value is ApprovedVehicleRoute {
  return typeof value === 'string' && APPROVED_VEHICLE_ROUTES.includes(value as ApprovedVehicleRoute);
}
