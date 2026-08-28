# GoCanteen Supabase connection

The app is wired to the existing Supabase project:
`https://cdrjfukxirkanrdklnli.supabase.co`

The frontend uses the publishable key through `VITE_SUPABASE_PUBLISHABLE_KEY`.
Never put a Supabase service-role/secret key in the app.

For local build, create `.env` from `.env.example` and set the publishable key.
The current app will fall back to local storage if the key is missing.

Admin login is authenticated with Supabase Auth using the internal identity:
`admin@gocanteen.local`
while the app login ID remains `admin`.
