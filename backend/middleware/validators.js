// middleware/validators.js
// Schema validation (zod) for the most security-sensitive endpoints. This
// primarily addresses the root cause of the "password in profile update"
// takeover: express-level validation now enforces the password policy in one
// place, requires currentPassword for any change of the account credential,
// and rejects unknown fields on the narrowest paths.
import { z } from 'zod';

const PASSWORD = z
  .string({ required_error: 'Password is required', invalid_type_error: 'Password must be a string' })
  .min(8, 'Password must be at least 8 characters long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter and one number')
  .regex(/[0-9]/, 'Password must contain at least one letter and one number');

export const updateUserProfileSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email().max(255).optional(),
    phone: z.string().max(20).optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    profilePicture: z.string().optional(),
  })
  .strict({ message: 'Unexpected field in profile update' })
  .refine((d) => Object.keys(d).length > 0, 'At least one field to update');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: PASSWORD,
  })
  .strict({ message: 'Unexpected field in password change' })
  .refine((d) => d.newPassword !== d.currentPassword, 'New password must be different from your current password');

export const registerSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email().max(255).optional(),
    password: PASSWORD.optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    legalConsentAccepted: z.boolean().optional(),
  })
  .partial();

// M-7: price had almost no schema anywhere. `productModel.create` rejected
// `price <= 0`, but the admin UPDATE path and BOTH vendor paths did a bare
// `parseFloat()` — so a vendor could publish a product at price 0 (buyers pay
// nothing) or -500 (a negative line in calcSubtotal). This is mounted on the
// four product create/update routes as express-level validation, so the input
// is rejected at the edge with a 400 instead of reaching money math.
//
// `.passthrough()` is load-bearing: a product payload carries ~50 fields
// (gallery, threadTypes, patternMeaning, …) and the default object schema
// STRIPS anything not declared. A stripping schema here would silently drop
// most of the product on every update — validation must not change what the
// endpoint accepts, only reject what is invalid.
//
// `price` is optional rather than required because "required" is already
// handled where it belongs — `productModel.create` and `createVendorProduct`
// both demand it — and this schema is mounted on update routes too, where an
// absent price means "leave it alone".
//
// Note `price: ''` is rejected (coerces to 0, not positive). That is a
// behaviour change from the model's `floatColumns` branch, which turned ''
// into NULL — and a NULL price makes `calcSubtotal` fall back to 0, i.e. a
// free product. Refusing it is the point.
export const productPriceSchema = z
  .object({
    price: z.coerce.number().positive('Price must be greater than 0').optional(),
  })
  .passthrough();

export const validate = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || 'Invalid request';
    res.status(400);
    return next(new Error(msg));
  }
  req.body = parsed.data;
  next();
};
