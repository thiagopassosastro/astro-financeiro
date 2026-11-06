-- Registra recebimentos e pagamentos usando as permissões do Financeiro.
create or replace function public.settle_installment_secure(p_kind text,p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare current_status public.financial_status;
begin
  if not public.is_current_user_finance() then raise exception 'Acesso restrito ao Financeiro'; end if;
  if p_kind='sale' then
    select status into current_status from public.receivables where id=p_id for update;
    if not found then raise exception 'Parcela a receber não encontrada'; end if;
    if current_status='cancelled' then raise exception 'Parcela cancelada não pode ser recebida'; end if;
    if current_status<>'paid' then update public.receivables set status='paid',received_at=now() where id=p_id; end if;
  elsif p_kind='expense' then
    select status into current_status from public.payables where id=p_id for update;
    if not found then raise exception 'Parcela a pagar não encontrada'; end if;
    if current_status='cancelled' then raise exception 'Parcela cancelada não pode ser paga'; end if;
    if current_status<>'paid' then update public.payables set status='paid',paid_at=now() where id=p_id; end if;
  else
    raise exception 'Tipo de parcela inválido';
  end if;
end;
$$;
revoke all on function public.settle_installment_secure(text,uuid) from public;
grant execute on function public.settle_installment_secure(text,uuid) to authenticated;
