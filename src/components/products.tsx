"use client";

import { useState } from "react";
import { Boxes, Clock3, ImageIcon, Plus, Search, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { brl, toCents } from "@/domain/finance";
import { useStore } from "./store";
import { Badge, Field } from "./ui";

export function ProductsView() {
  const { state, addProduct, updateProductCost } = useStore();
  const [modal, setModal] = useState(false);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageError, setImageError] = useState("");
  const filtered = state.products.filter((product) => (product.name + product.sku).toLowerCase().includes(query.toLowerCase()));

  const closeModal = () => { setModal(false); setImageUrl(undefined); setImageError(""); };
  const chooseImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setImageError("Selecione um arquivo de imagem."); return; }
    if (file.size > 1_500_000) { setImageError("A imagem deve ter no máximo 1,5 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { setImageUrl(String(reader.result)); setImageError(""); };
    reader.readAsDataURL(file);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await addProduct({ id: crypto.randomUUID(), name: String(form.get("name")), sku: String(form.get("sku")), category: String(form.get("category")), origin: String(form.get("origin")) as "Importado", costCents: toCents(String(form.get("cost"))), suggestedPriceCents: toCents(String(form.get("price"))), imageUrl, active: true, updatedAt: new Date().toISOString().slice(0, 10) });
    closeModal();
  };

  return <>
    <div className="view-actions"><div className="input-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou SKU..."/></div><button className="secondary"><SlidersHorizontal size={17}/>Filtros</button><button className="primary" onClick={() => setModal(true)}><Plus size={17}/>Novo equipamento</button></div>
    <div className="panel table-panel"><table><thead><tr><th>Equipamento</th><th>Categoria</th><th>Origem</th><th>Custo atual</th><th>Preço sugerido</th><th>Status</th><th>Atualização</th><th/></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><div className="product-cell"><div className={`product-icon ${product.imageUrl ? "has-image" : ""}`}>{product.imageUrl ? <img src={product.imageUrl} alt={product.name}/> : <Boxes size={19}/>}</div><div><strong>{product.name}</strong><span>SKU {product.sku}</span></div></div></td><td>{product.category}</td><td>{product.origin}</td><td><strong>{brl(product.costCents)}</strong></td><td>{product.suggestedPriceCents ? brl(product.suggestedPriceCents) : "—"}</td><td><Badge tone="success">Ativo</Badge></td><td>{new Date(product.updatedAt + "T12:00").toLocaleDateString("pt-BR")}</td><td><button className="table-action" onClick={() => setHistory(product.id)}><Clock3 size={17}/></button></td></tr>)}</tbody></table><div className="table-footer">Mostrando {filtered.length} equipamentos <span>Custos históricos protegidos</span></div></div>
    {modal && <div className="modal-backdrop"><form className="modal product-modal" onSubmit={submit}><div className="modal-head"><div><h3>Novo equipamento</h3><p>Cadastre o item, a imagem e seu custo inicial.</p></div><button type="button" onClick={closeModal}><X/></button></div><div className="product-form-body"><div className="product-upload"><span>Imagem do produto</span>{imageUrl ? <div className="image-preview"><img src={imageUrl} alt="Pré-visualização do equipamento"/><button type="button" onClick={() => setImageUrl(undefined)}><Trash2 size={15}/>Remover</button></div> : <label className="upload-drop"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage}/><ImageIcon/><strong>Adicionar imagem</strong><small>PNG, JPG ou WEBP · máximo 1,5 MB</small><em><Upload size={14}/>Selecionar arquivo</em></label>}{imageError && <small className="upload-error">{imageError}</small>}</div><div className="form-grid"><Field label="Nome do equipamento"><input name="name" required placeholder="Ex: Leg Press Pro"/></Field><Field label="Código / SKU"><input name="sku" required placeholder="LP-PRO"/></Field><Field label="Categoria"><select name="category"><option>Cardio</option><option>Musculação</option><option>Acessórios</option></select></Field><Field label="Origem"><select name="origin"><option>Fabricação própria</option><option>Importado</option></select></Field><Field label="Custo atual"><input name="cost" required placeholder="R$ 0,00"/></Field><Field label="Preço sugerido (opcional)"><input name="price" placeholder="R$ 0,00"/></Field></div></div><div className="modal-actions"><button type="button" className="secondary" onClick={closeModal}>Cancelar</button><button className="primary">Salvar equipamento</button></div></form></div>}
    {history && <CostDrawer productId={history} close={() => setHistory(null)} update={updateProductCost}/>} 
  </>;
}

function CostDrawer({ productId, close, update }: { productId: string; close: () => void; update: (id: string, cost: number) => void }) {
  const { state } = useStore(); const product = state.products.find((item) => item.id === productId)!; const list = state.costHistory.filter((item) => item.productId === productId); const [cost, setCost] = useState("");
  return <div className="modal-backdrop right"><aside className="drawer"><div className="modal-head"><div><h3>Histórico de custo</h3><p>{product.name} · {product.sku}</p></div><button onClick={close}><X/></button></div><div className="cost-current"><span>Custo atual</span><strong>{brl(product.costCents)}</strong></div><Field label="Registrar novo custo"><div className="inline-field"><input value={cost} onChange={(event) => setCost(event.target.value)} placeholder="R$ 0,00"/><button className="primary" onClick={() => { if (toCents(cost) > 0) { update(productId, toCents(cost)); setCost(""); } }}>Atualizar</button></div></Field><div className="timeline">{list.map((item, index) => <div key={item.id}><i/><div><strong>{brl(item.costCents)}</strong><span>{new Date(item.effectiveAt + "T12:00").toLocaleDateString("pt-BR")}{index === 0 ? " · Custo atual" : ""}</span></div></div>)}</div><div className="drawer-note"><Clock3 size={17}/>Nenhum custo anterior é apagado. Vendas já realizadas continuam usando o custo registrado no momento da venda.</div></aside></div>;
}
