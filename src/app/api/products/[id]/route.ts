import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const parsed = idSchema.safeParse(rawId);
  if (!parsed.success) return NextResponse.json({ error: "Equipamento inválido." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Faça login novamente para continuar." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
  if (!profile?.active || !["admin", "stock_operator"].includes(profile.role)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir equipamentos." }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const product = await admin.from("products").select("id, deleted_at").eq("id", parsed.data).maybeSingle();
    if (product.error) throw product.error;
    if (!product.data || product.data.deleted_at) return NextResponse.json({ error: "Este equipamento já foi excluído." }, { status: 404 });

    const sales = await admin.from("sale_items").select("id", { count: "exact", head: true }).eq("product_id", parsed.data);
    if (sales.error) throw sales.error;
    if ((sales.count || 0) > 0) {
      return NextResponse.json({ error: "Este equipamento já faz parte de uma venda e não pode ser excluído. O histórico financeiro precisa ser preservado." }, { status: 409 });
    }

    const deletedAt = new Date().toISOString();
    const inputs = await admin.from("product_inputs").update({ deleted_at: deletedAt }).eq("product_id", parsed.data).is("deleted_at", null);
    if (inputs.error) throw inputs.error;
    const productUpdate = await admin.from("products").update({ deleted_at: deletedAt, active: false }).eq("id", parsed.data).is("deleted_at", null);
    if (productUpdate.error) throw productUpdate.error;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_KEY_NOT_CONFIGURED") {
      return NextResponse.json({ error: "A configuração administrativa do servidor está indisponível." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível excluir o equipamento." }, { status: 500 });
  }
}
