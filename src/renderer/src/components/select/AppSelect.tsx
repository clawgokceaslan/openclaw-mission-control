import { useMemo } from 'react'
import Select, { type MultiValue, type SingleValue, type StylesConfig } from 'react-select'
import CreatableSelect from 'react-select/creatable'
import { readableTextColor, tagColorStyle } from '@renderer/components/tags/TagPill'
import styles from './AppSelect.module.scss'

export type AppSelectOption = {
  label: string
  value: string
  color?: string
}

type BaseProps = {
  className?: string
  options: AppSelectOption[]
  placeholder?: string
  isClearable?: boolean
  onCreateOption?: (value: string) => void
  variant?: 'default' | 'borderless'
}

type MultiProps = BaseProps & {
  mode: 'multi'
  value: AppSelectOption[]
  onChange: (value: AppSelectOption[]) => void
}

type SingleProps = BaseProps & {
  mode?: 'single'
  value: AppSelectOption | null
  onChange: (value: AppSelectOption | null) => void
}

export type AppSelectProps = (MultiProps | SingleProps) & {
  creatable?: boolean
}

export function AppSelect(props: AppSelectProps) {
  const {
    className,
    options,
    placeholder = 'Select...',
    isClearable = false,
    onCreateOption,
    variant = 'default'
  } = props
  const isMulti = props.mode === 'multi'
  const Component = props.creatable ? CreatableSelect : Select
  const selectStyles = useMemo<StylesConfig<AppSelectOption, boolean>>(() => ({
    multiValue: (base, state) => {
      const color = state.data.color
      if (!color) return base
      return {
        ...base,
        backgroundColor: color,
        border: '1px solid rgba(20, 37, 62, 0.08)',
        borderRadius: 999,
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.24)',
        color: readableTextColor(color),
        minHeight: 24
      }
    },
    multiValueLabel: (base, state) => {
      const color = state.data.color
      if (!color) return base
      return {
        ...base,
        color: readableTextColor(color),
        fontSize: '0.84rem',
        fontWeight: 760,
        lineHeight: 1,
        padding: '2px 7px'
      }
    },
    multiValueRemove: (base, state) => {
      const color = state.data.color
      if (!color) return base
      return {
        ...base,
        color: readableTextColor(color),
        ':hover': {
          backgroundColor: 'rgba(255, 255, 255, 0.22)',
          color: readableTextColor(color)
        }
      }
    }
  }), [])

  const mergedClassName = useMemo(() => {
    const base = variant === 'borderless' ? `${styles.appSelect} ${styles.borderless}` : styles.appSelect
    return className ? `${base} ${className}` : base
  }, [className, variant])

  return (
    <Component<AppSelectOption, boolean>
      className={mergedClassName}
      classNamePrefix="app-select"
      options={options}
      value={props.value as AppSelectOption[] | AppSelectOption | null}
      isMulti={isMulti}
      isClearable={isClearable}
      placeholder={placeholder}
      menuPlacement="auto"
      onCreateOption={onCreateOption}
      styles={selectStyles}
      formatOptionLabel={(option) => (
        <span className={styles.optionLabel}>
          {option.color ? <span className={styles.optionColor} style={tagColorStyle(option.color)} /> : null}
          <span>{option.label}</span>
        </span>
      )}
      onChange={(nextValue) => {
        if (isMulti) {
          props.onChange((nextValue as MultiValue<AppSelectOption>).map((item) => item))
          return
        }
        props.onChange((nextValue as SingleValue<AppSelectOption>) ?? null)
      }}
    />
  )
}
