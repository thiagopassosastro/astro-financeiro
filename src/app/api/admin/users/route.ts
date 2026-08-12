import { NextResponse } from "next/server";
import { z } from "zod";
import type { AccessRole } from "@/domain/types";
import { createAdminClient, requireAdministrator } from "@/lib/supabase/admin";

const roleSchema = z.enum(["admin", "stock_operator"]);
const createSchema = z.object({
  fullName: z.string().trim().min(3).max(100), email: z.string().email(),
  password: z.string().min(8).max(72), role: roleSchema,
});
const updateSchema = z.discriminatedUnion("action", [
  z.object({ action:z.literal("role"), id:z.string().uuid(), role:roleSchema }),
  z.object({ action:z.literal("deactivate"), id:z.string().uuid() }),
  z.object({ action:z.literal("activate"), id:z.string().uuid() }),
  z.object({ action:z.literal("reset_password"), id:z.string().uuid(), password:z.string().min(8).max(72) }),
]);

const configurationError = () => NextResponse.json({error:"A chave administrativa do Supabase ainda não foi configurada no servidor."},{status:503});

export async function GET() {
  const access=await requireAdministrator(); if(!access)return NextResponse.json({error:"Acesso restrito a Administradores."},{status:403});
  try {
    const admin=createAdminClient();
    const [{data:authData,error:authError},{data:profiles,error:profilesError}]=await Promise.all([
      admin.auth.admin.listUsers({page:1,perPage:1000}),
      access.supabase.from("profiles").select("id, full_name, role, active, must_change_password").order("created_at"),
    ]);
    if(authError||profilesError)throw authError||profilesError;
    const profileById=new Map((profiles||[]).map(profile=>[profile.id,profile]));
    return NextResponse.json({users:authData.users.map(user=>{const profile=profileById.get(user.id);return{id:user.id,fullName:profile?.full_name||String(user.user_metadata?.full_name||user.email?.split("@")[0]||"Usuário"),email:user.email||"",role:(profile?.role||"stock_operator") as AccessRole,active:profile?.active??true,mustChangePassword:profile?.must_change_password??false,lastSignInAt:user.last_sign_in_at||undefined}})});
  } catch(error) { if(error instanceof Error&&error.message==="ADMIN_KEY_NOT_CONFIGURED")return configurationError();return NextResponse.json({error:"Não foi possível carregar os usuários."},{status:500}); }
}

export async function POST(request:Request) {
  const access=await requireAdministrator(); if(!access)return NextResponse.json({error:"Acesso restrito a Administradores."},{status:403});
  const parsed=createSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Preencha nome, e-mail, senha temporária e cargo corretamente."},{status:400});
  try {
    const admin=createAdminClient(); const {fullName,email,password,role}=parsed.data;
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName,must_change_password:true}});
    if(created.error) return NextResponse.json({error:created.error.message.toLowerCase().includes("already")?"Este e-mail já está cadastrado.":"Não foi possível criar a conta."},{status:400});
    const profile=await admin.from("profiles").update({full_name:fullName,role,active:true,must_change_password:true,deactivated_at:null}).eq("id",created.data.user.id);
    if(profile.error){await admin.auth.admin.deleteUser(created.data.user.id);throw profile.error}
    return NextResponse.json({success:true},{status:201});
  } catch(error) { if(error instanceof Error&&error.message==="ADMIN_KEY_NOT_CONFIGURED")return configurationError();return NextResponse.json({error:"Não foi possível criar a conta."},{status:500}); }
}

export async function PATCH(request:Request) {
  const access=await requireAdministrator(); if(!access)return NextResponse.json({error:"Acesso restrito a Administradores."},{status:403});
  const parsed=updateSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Alteração inválida."},{status:400});
  if(parsed.data.id===access.user.id&&["deactivate","role"].includes(parsed.data.action))return NextResponse.json({error:"Você não pode remover o acesso administrativo da própria conta."},{status:400});
  try {
    const admin=createAdminClient(); const input=parsed.data;
    if(input.action==="role") { const result=await admin.from("profiles").update({role:input.role}).eq("id",input.id);if(result.error)throw result.error; }
    if(input.action==="deactivate") { const auth=await admin.auth.admin.updateUserById(input.id,{ban_duration:"876000h"});if(auth.error)throw auth.error;const profile=await admin.from("profiles").update({active:false,deactivated_at:new Date().toISOString()}).eq("id",input.id);if(profile.error)throw profile.error; }
    if(input.action==="activate") { const auth=await admin.auth.admin.updateUserById(input.id,{ban_duration:"none"});if(auth.error)throw auth.error;const profile=await admin.from("profiles").update({active:true,deactivated_at:null}).eq("id",input.id);if(profile.error)throw profile.error; }
    if(input.action==="reset_password") { const auth=await admin.auth.admin.updateUserById(input.id,{password:input.password,user_metadata:{...((await admin.auth.admin.getUserById(input.id)).data.user?.user_metadata||{}),must_change_password:true}});if(auth.error)throw auth.error;const profile=await admin.from("profiles").update({must_change_password:true}).eq("id",input.id);if(profile.error)throw profile.error; }
    return NextResponse.json({success:true});
  } catch(error) { if(error instanceof Error&&error.message==="ADMIN_KEY_NOT_CONFIGURED")return configurationError();return NextResponse.json({error:"Não foi possível concluir a alteração."},{status:500}); }
}
