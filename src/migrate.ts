import type { AppState, Item, Category, Inventory, PackingList } from './types';

function generateId(): string {
  return crypto.randomUUID();
}

type LegacyItem = {
  id: string;
  name: string;
  checked: boolean;
  categoryId: string | null;
  location?: 'packing' | 'inventory';
  packingListId?: string | null;
  count?: number;
};

type LegacyCat = Omit<Category, 'isContainer' | 'packed' | 'bagCategoryId' | 'packingListId'> &
  Partial<Pick<Category, 'isContainer' | 'packed' | 'bagCategoryId' | 'packingListId'>>;

export type RawState = {
  // old flat format
  items?: LegacyItem[];
  categories?: LegacyCat[];
  // new nested format
  inventories?: Inventory[];
  activeInventoryId?: string;
  activeTab?: AppState['activeTab'];
};

export function migrateState(raw: RawState): AppState {
  if (raw.inventories && raw.inventories.length > 0) {
    return {
      inventories: raw.inventories.map(inv => ({
        ...inv,
        categories: (inv.categories as (Omit<Category, 'bagCategoryId' | 'packingListId'> & { bagCategoryId?: string | null; packingListId?: string | null })[]).map(
          c => ({ bagCategoryId: null, packingListId: null, ...c }),
        ),
        items: (inv.items as (Omit<Item, 'count' | 'bagCategoryId'> & { count?: number; bagCategoryId?: string | null })[]).map(
          i => ({ count: 1, bagCategoryId: null, ...i }),
        ),
      })),
      activeInventoryId: raw.activeInventoryId ?? raw.inventories[0].id,
      activeTab: raw.activeTab ?? 'packing',
    };
  }

  // Migrate from old flat format
  const defaultPackingList: PackingList = { id: generateId(), name: 'Packing List' };

  const categories: Category[] = (raw.categories ?? []).map(c => ({
    isContainer: false,
    packed: false,
    bagCategoryId: null,
    packingListId: null,
    ...c,
  }));

  const items: Item[] = (raw.items ?? []).map((i): Item => ({
    id: i.id,
    name: i.name,
    checked: i.checked,
    count: i.count ?? 1,
    categoryId: i.categoryId,
    bagCategoryId: null,
    packingListId:
      i.packingListId !== undefined
        ? i.packingListId
        : i.location === 'packing'
          ? defaultPackingList.id
          : null,
  }));

  const inventory: Inventory = {
    id: generateId(),
    name: 'My Stuff',
    categories,
    items,
    packingLists: [defaultPackingList],
    activePackingListId: defaultPackingList.id,
  };

  return {
    inventories: [inventory],
    activeInventoryId: inventory.id,
    activeTab: raw.activeTab ?? 'packing',
  };
}
