-- Mercan Food Sales & Inventory Manager
-- Run this entire file in Supabase SQL Editor as the project owner.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  category text not null default 'Food',
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  stock integer not null default 0 check (stock >= 0),
  low_stock_at integer not null default 5 check (low_stock_at >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'completed' check (status in ('completed','void')),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  total_cost numeric(12,2) not null default 0 check (total_cost >= 0),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  line_cost numeric(12,2) generated always as (quantity * unit_cost) stored
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null default 'Supplies',
  description text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists sales_created_at_idx on public.sales(created_at desc);
create index if not exists sale_items_sale_id_idx on public.sale_items(sale_id);
create index if not exists expenses_expense_date_idx on public.expenses(expense_date desc);

alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.expenses enable row level security;

-- Only signed-in users can read. With public sign-ups disabled and one manually
-- created Auth user, this is the shared single-account workspace.
drop policy if exists "authenticated users manage products" on public.products;
create policy "authenticated users manage products" on public.products
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated users read sales" on public.sales;
create policy "authenticated users read sales" on public.sales
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "authenticated users read sale items" on public.sale_items;
create policy "authenticated users read sale items" on public.sale_items
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "authenticated users manage expenses" on public.expenses;
create policy "authenticated users manage expenses" on public.expenses
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

-- Atomic sale creation: row locks prevent two tills from selling the same last unit.
create or replace function public.create_sale(items jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_total numeric(12,2) := 0;
  v_cost numeric(12,2) := 0;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'A sale must contain at least one item';
  end if;
  if jsonb_array_length(items) > 100 then raise exception 'Too many sale lines'; end if;

  insert into public.sales(status) values ('completed') returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(items) loop
    if coalesce(v_item->>'product_id','') = '' then raise exception 'Invalid product'; end if;
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be a positive whole number'; end if;

    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid for update;
    if not found then raise exception 'A selected product no longer exists'; end if;
    if v_product.stock < v_qty then
      raise exception 'Insufficient stock for % (available: %)', v_product.name, v_product.stock;
    end if;

    update public.products set stock = stock - v_qty, updated_at = now() where id = v_product.id;
    insert into public.sale_items(sale_id, product_id, product_name, quantity, unit_price, unit_cost)
      values (v_sale_id, v_product.id, v_product.name, v_qty, v_product.selling_price, v_product.cost_price);
    v_total := v_total + (v_product.selling_price * v_qty);
    v_cost := v_cost + (v_product.cost_price * v_qty);
    v_count := v_count + 1;
  end loop;

  update public.sales set total_amount = v_total, total_cost = v_cost where id = v_sale_id;
  return v_sale_id;
exception when others then
  raise;
end;
$$;

-- Void a sale once only and restore its inventory in the same transaction.
create or replace function public.void_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.sales%rowtype;
  v_item record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status <> 'completed' then raise exception 'Only completed sales can be voided'; end if;

  for v_item in
    select product_id, sum(quantity)::integer as qty
    from public.sale_items where sale_items.sale_id = p_sale_id and product_id is not null
    group by product_id
  loop
    update public.products set stock = stock + v_item.qty, updated_at = now()
    where id = v_item.product_id;
  end loop;
  update public.sales set status = 'void', voided_at = now() where id = p_sale_id;
end;
$$;

revoke all on function public.create_sale(jsonb) from public, anon;
revoke all on function public.void_sale(uuid) from public, anon;
grant execute on function public.create_sale(jsonb) to authenticated;
grant execute on function public.void_sale(uuid) to authenticated;

grant select, insert, update, delete on public.products to authenticated;
grant select on public.sales, public.sale_items to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

-- Enable realtime publication for shared tables (safe to run repeatedly).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='products') then
    alter publication supabase_realtime add table public.products;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sale_items') then
    alter publication supabase_realtime add table public.sale_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='expenses') then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;
