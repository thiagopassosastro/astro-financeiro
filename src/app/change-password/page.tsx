"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ChangePasswordPage(){
  const [show,setShow]=useState(false);const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget),password=String(form.get("password")),confirmation=String(form.get("confirmation"));if(password!==confirmation){setError("As senhas não coincidem.");return}setLoading(true);setError("");const supabase=createClient();const update=await supabase.auth.updateUser({password});if(update.error){setError("Não foi possível alterar a senha.");setLoading(false);return}const complete=await supabase.rpc("complete_password_change");if(complete.error){setError("A senha foi alterada, mas não foi possível concluir o primeiro acesso.");setLoading(false);return}window.location.href="/"};
  return <main className="password-page"><form className="password-card" onSubmit={submit}><div className="password-icon"><ShieldCheck/></div><span>PRIMEIRO ACESSO</span><h1>Crie sua senha definitiva</h1><p>Substitua a senha temporária recebida do Administrador. Use pelo menos 8 caracteres.</p><label><span>Nova senha</span><div><KeyRound/><input name="password" type={show?"text":"password"} minLength={8} required/><button type="button" onClick={()=>setShow(value=>!value)}>{show?<EyeOff/>:<Eye/>}</button></div></label><label><span>Confirmar nova senha</span><div><KeyRound/><input name="confirmation" type={show?"text":"password"} minLength={8} required/></div></label>{error&&<div className="login-error">{error}</div>}<button className="login-submit" disabled={loading}>{loading?"Salvando...":"Definir nova senha"}</button><small>A senha temporária deixa de funcionar após esta alteração.</small></form></main>
}
