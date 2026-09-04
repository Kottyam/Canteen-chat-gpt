# GoCanteen UPI Intent Test Spec

For a ₹60 payment batch, the generated URI must have exactly these query keys and values:

- `pa`: the bill's snapshotted receiving UPI ID from Payment Settings
- `pn`: the bill's snapshotted receiving UPI name
- `am`: `60.00`
- `cu`: `INR`
- `tr`: a unique alphanumeric batch reference, no more than 35 characters
- `tn`: a short GoCanteen bill/batch note

The URI must begin with `upi://pay?`. Each query value is encoded once by `URLSearchParams`; the complete URI is not encoded again.

Android launch uses Capacitor `AppLauncher.openUrl({ url })`, so the `upi://` URI is handed to Android as an external URL rather than opened inside GoCanteen's WebView/navigation.

Opening the UPI app must not update Supabase payment status. Only the existing `I Have Paid` action calls `confirm_bill_payment` and moves the request to `pending_verification`.

Real-device acceptance test: use ₹60 and test at least two installed UPI apps. Confirm recipient, amount, reference/note, and that no malformed URI is generated. If a valid URI still receives a PSP/bank risk warning, treat that as an external recipient/account/PSP risk decision rather than bypassing it.
