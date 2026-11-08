import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  DEFAULT_PRODUCT_ATTRIBUTE_TYPES,
  normalizeAttributeValue,
  type ProductAttributeField,
  type ProductAttributeFieldType,
  type ProductAttributeType,
} from '../config/productAttributes';
import type { Product } from '../types';
import { Button, Input, Select } from './ui';

interface AttributeFieldsProps {
  productTypes?: ProductAttributeType[];
  selectedTypeId: string;
  attributes: Record<string, string>;
  serialNumber: string;
  products: Product[];
  canEdit: boolean;
  onTypeChange: (typeId: string) => void;
  onAttributesChange: (attributes: Record<string, string>) => void;
  onSerialNumberChange: (serialNumber: string) => void;
  onProductTypesChange: (productTypes: ProductAttributeType[]) => void;
}

const EMPTY_FIELD: ProductAttributeField = { key: '', label: '', type: 'text' };

export default function AttributeFields({
  productTypes = DEFAULT_PRODUCT_ATTRIBUTE_TYPES,
  selectedTypeId,
  attributes,
  serialNumber,
  products,
  canEdit,
  onTypeChange,
  onAttributesChange,
  onSerialNumberChange,
  onProductTypesChange,
}: AttributeFieldsProps) {
  const [newTypeName, setNewTypeName] = useState('');
  const [newField, setNewField] = useState<ProductAttributeField>(EMPTY_FIELD);
  const [newOption, setNewOption] = useState<Record<string, string>>({});
  const types = productTypes.length ? productTypes : DEFAULT_PRODUCT_ATTRIBUTE_TYPES;
  const selectedType = types.find(type => type.id === selectedTypeId);
  const suggestionsByKey = useMemo(() => {
    const suggestions: Record<string, string[]> = {};
    for (const product of products) {
      for (const [key, value] of Object.entries(product.attributes || {})) {
        const normalized = normalizeAttributeValue(value);
        if (value.trim() && !(suggestions[key] || []).some(item => normalizeAttributeValue(item) === normalized)) {
          (suggestions[key] ||= []).push(value);
        }
      }
    }
    return suggestions;
  }, [products]);

  const updateField = (field: ProductAttributeField, value: string) => {
    onAttributesChange({ ...attributes, [field.label]: value });
  };

  const addType = () => {
    const name = newTypeName.trim();
    if (!name || types.some(type => normalizeAttributeValue(type.name) === normalizeAttributeValue(name))) return;
    const id = `custom-${Date.now()}`;
    onProductTypesChange([...types, { id, name, fields: [] }]);
    onTypeChange(id);
    setNewTypeName('');
  };

  const addField = () => {
    const label = newField.label.trim();
    const key = newField.key.trim() || label;
    if (!selectedType || !label || selectedType.fields.some(field => normalizeAttributeValue(field.label) === normalizeAttributeValue(label))) return;
    const field = { ...newField, key, label };
    onProductTypesChange(types.map(type => type.id === selectedType.id ? { ...type, fields: [...type.fields, field] } : type));
    setNewField(EMPTY_FIELD);
  };

  const addOption = (field: ProductAttributeField) => {
    const value = newOption[field.key]?.trim();
    if (!value || (field.options || []).some(option => normalizeAttributeValue(option) === normalizeAttributeValue(value))) return;
    onProductTypesChange(types.map(type => type.id !== selectedType?.id ? type : {
      ...type,
      fields: type.fields.map(item => item.key === field.key ? { ...item, options: [...(item.options || []), value] } : item),
    }));
    updateField(field, value);
    setNewOption(current => ({ ...current, [field.key]: '' }));
  };

  return (
    <section className="col-span-2 space-y-3 rounded-ds-md border border-ds-border bg-ds-surface-2 p-3">
      <div>
        <label htmlFor="product-attribute-type" className="mb-1 block text-sm font-medium text-ds-text">Type de caractéristiques</label>
        <Select id="product-attribute-type" value={selectedTypeId} onChange={event => onTypeChange(event.target.value)} disabled={!canEdit} className="min-h-11 text-base sm:text-sm">
          <option value="">Aucun modèle</option>
          {types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
        </Select>
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <Input value={newTypeName} onChange={event => setNewTypeName(event.target.value)} placeholder="Créer un type" className="min-w-0 text-base sm:text-sm" />
          <Button type="button" variant="secondary" onClick={addType} disabled={!newTypeName.trim()} className="min-h-11 shrink-0"><Plus className="h-4 w-4" /> Type</Button>
        </div>
      )}

      {selectedType?.fields.map(field => {
        const options = field.options || [];
        const suggestions = suggestionsByKey[field.label] || [];
        const dataListId = `product-attribute-values-${selectedType.id}-${field.key}`;
        return (
          <div key={field.key}>
            <label htmlFor={`product-attribute-${field.key}`} className="mb-1 block text-sm font-medium text-ds-text">{field.label}</label>
            {field.type === 'boolean' ? (
              <Select id={`product-attribute-${field.key}`} value={attributes[field.label] || ''} onChange={event => updateField(field, event.target.value)} disabled={!canEdit} className="min-h-11 text-base sm:text-sm">
                <option value="">Non renseigné</option><option value="Oui">Oui</option><option value="Non">Non</option>
              </Select>
            ) : field.type === 'choice' ? (
              <div className="space-y-2">
                <Input id={`product-attribute-${field.key}`} list={dataListId} value={attributes[field.label] || ''} onChange={event => updateField(field, event.target.value)} readOnly={!canEdit} className="text-base sm:text-sm" />
                <datalist id={dataListId}>{[...new Set([...options, ...suggestions])].map(value => <option key={value} value={value} />)}</datalist>
                {canEdit && (
                  <div className="flex gap-2">
                    <Input value={newOption[field.key] || ''} onChange={event => setNewOption(current => ({ ...current, [field.key]: event.target.value }))} placeholder={`Ajouter une valeur pour ${field.label}`} className="min-w-0 text-base sm:text-sm" />
                    <Button type="button" variant="secondary" onClick={() => addOption(field)} disabled={!newOption[field.key]?.trim()} className="min-h-11 shrink-0"><Plus className="h-4 w-4" /> Valeur</Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Input
                  id={`product-attribute-${field.key}`}
                  type={field.type === 'number' ? 'number' : 'text'}
                  list={dataListId}
                  value={attributes[field.label] || ''}
                  onChange={event => updateField(field, event.target.value)}
                  readOnly={!canEdit}
                  className="text-base sm:text-sm"
                />
                <datalist id={dataListId}>{suggestions.map(value => <option key={value} value={value} />)}</datalist>
              </>
            )}
          </div>
        );
      })}

      {canEdit && selectedType && (
        <div className="space-y-2 border-t border-ds-border pt-3">
          <p className="text-xs font-bold text-ds-text-muted">Ajouter un champ à « {selectedType.name} »</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Input value={newField.label} onChange={event => setNewField(current => ({ ...current, label: event.target.value }))} placeholder="Libellé" className="text-base sm:text-sm" />
            <Select value={newField.type} onChange={event => setNewField(current => ({ ...current, type: event.target.value as ProductAttributeFieldType }))} className="min-h-11 text-base sm:text-sm">
              <option value="text">Texte</option><option value="choice">Choix</option><option value="boolean">Oui/non</option><option value="number">Nombre</option>
            </Select>
            <Button type="button" variant="secondary" onClick={addField} disabled={!newField.label.trim()} className="min-h-11"><Plus className="h-4 w-4" /> Champ</Button>
          </div>
        </div>
      )}

      <div>
        <label htmlFor="product-serial-number" className="mb-1 block text-sm font-medium text-ds-text">IMEI / n° de série</label>
        <div className="flex gap-2">
          <Input id="product-serial-number" value={serialNumber} onChange={event => onSerialNumberChange(event.target.value)} readOnly={!canEdit} className="min-w-0 text-base sm:text-sm" />
          {canEdit && serialNumber && <button type="button" onClick={() => onSerialNumberChange('')} aria-label="Effacer le numéro de série" className="min-h-11 min-w-11 rounded-ds-md border border-ds-border text-ds-text-muted"><X className="mx-auto h-4 w-4" /></button>}
        </div>
      </div>
    </section>
  );
}
