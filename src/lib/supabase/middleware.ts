import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const isChangePassword = request.nextUrl.pathname.startsWith("/change-password");
  if (!user && !isLogin && !isApi) return NextResponse.redirect(new URL("/login", request.url));
  if (user) {
    const {data:profile}=await supabase.from("profiles").select("active, must_change_password").eq("id",user.id).maybeSingle();
    if(profile?.active===false){
      if(!isLogin&&!isApi)return NextResponse.redirect(new URL("/login?inactive=1",request.url));
      return response;
    }
    if(profile?.must_change_password&&!isChangePassword&&!isApi)return NextResponse.redirect(new URL("/change-password",request.url));
    if(!profile?.must_change_password&&isChangePassword)return NextResponse.redirect(new URL("/",request.url));
  }
  if (user && isLogin) return NextResponse.redirect(new URL("/", request.url));
  return response;
}
