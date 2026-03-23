import { describe, it, expect } from 'vitest'
import {
  enumerateVariantProps,
  generateArgTypes,
  generateDefaultArgs,
  getVariantClass,
  createVariantStoryArgs,
  withTailwindStyled,
  type ComponentConfig,
} from './src/index'

describe('enumerateVariantProps', () => {
  it('should generate all combinations for 2 variants with 3 options each', () => {
    const matrix = { size: ['sm', 'md', 'lg'], intent: ['primary', 'secondary', 'danger'] }
    const result = enumerateVariantProps(matrix)
    expect(result).toHaveLength(9) // 3 * 3
  })

  it('should handle empty matrix', () => {
    const result = enumerateVariantProps({})
    expect(result).toEqual([{}])
  })

  it('should handle single variant', () => {
    const result = enumerateVariantProps({ size: ['sm', 'lg'] })
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ size: 'sm' })
    expect(result).toContainEqual({ size: 'lg' })
  })

  it('should handle variant with boolean values', () => {
    const result = enumerateVariantProps({ disabled: [true, false] })
    expect(result).toHaveLength(2)
  })

  it('should handle variant with numeric values', () => {
    const result = enumerateVariantProps({ level: [1, 2, 3] })
    expect(result).toHaveLength(3)
  })
})

describe('generateArgTypes', () => {
  const config: ComponentConfig = {
    base: 'btn',
    variants: {
      size: { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' },
      intent: { primary: 'btn-primary', danger: 'btn-danger' },
    },
    defaultVariants: { size: 'md', intent: 'primary' },
  }

  it('should generate argTypes with select controls', () => {
    const argTypes = generateArgTypes(config)
    expect(argTypes.size).toBeDefined()
    expect(argTypes.intent).toBeDefined()
    expect(argTypes.size).toHaveProperty('control', { type: 'select' })
    expect(argTypes.size).toHaveProperty('options', ['sm', 'md', 'lg'])
    expect(argTypes.size).toHaveProperty('defaultValue', 'md')
  })

  it('should return empty object when no variants', () => {
    const result = generateArgTypes({ base: 'btn' })
    expect(result).toEqual({})
  })

  it('should include description and table metadata', () => {
    const argTypes = generateArgTypes(config)
    expect(argTypes.size).toHaveProperty('description')
    expect(argTypes.size).toHaveProperty('table')
    expect(argTypes.size.table).toHaveProperty('category', 'Variants')
  })
})

describe('generateDefaultArgs', () => {
  it('should return default variants', () => {
    const config: ComponentConfig = {
      defaultVariants: { size: 'md', intent: 'primary' },
    }
    expect(generateDefaultArgs(config)).toEqual({ size: 'md', intent: 'primary' })
  })

  it('should return empty object when no defaultVariants', () => {
    const result = generateDefaultArgs({ base: 'btn' })
    expect(result).toEqual({})
  })
})

describe('getVariantClass', () => {
  const config: ComponentConfig = {
    base: 'btn',
    variants: {
      size: { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' },
      intent: { primary: 'btn-primary', danger: 'btn-danger' },
    },
    compoundVariants: [
      { class: 'btn-lg-primary', size: 'lg', intent: 'primary' },
    ],
  }

  it('should combine base and variant classes', () => {
    const result = getVariantClass(config, { size: 'md', intent: 'primary' })
    expect(result).toBe('btn btn-md btn-primary')
  })

  it('should use default variants when not provided', () => {
    const configWithDefaults: ComponentConfig = {
      base: 'btn',
      variants: { size: { sm: 'btn-sm', md: 'btn-md' } },
      defaultVariants: { size: 'md' },
    }
    const result = getVariantClass(configWithDefaults, {})
    expect(result).toBe('btn btn-md')
  })

  it('should handle compound variants', () => {
    const result = getVariantClass(config, { size: 'lg', intent: 'primary' })
    expect(result).toContain('btn-lg-primary')
  })

  it('should return base only when no variants match', () => {
    const result = getVariantClass(config, {})
    expect(result).toBe('btn')
  })
})

describe('createVariantStoryArgs', () => {
  it('should return combinations and matrix', () => {
    const config: ComponentConfig = {
      variants: {
        size: { sm: 'sm', md: 'md' },
        intent: { primary: 'primary', danger: 'danger' },
      },
    }
    const result = createVariantStoryArgs(config)
    expect(result.combinations).toHaveLength(4)
    expect(result.matrix).toEqual({ size: ['sm', 'md'], intent: ['primary', 'danger'] })
  })

  it('should handle empty variants', () => {
    const result = createVariantStoryArgs({ base: 'btn' })
    expect(result.combinations).toEqual([{}])
    expect(result.matrix).toEqual({})
  })
})

describe('withTailwindStyled', () => {
  it('should return StoryFn when document is not defined', () => {
    const StoryFn = () => 'story'
    const context = { args: {}, parameters: {} }
    const result = withTailwindStyled(StoryFn, context)
    expect(result).toBe('story')
  })

  it('should use custom padding from parameters', () => {
    const StoryFn = () => 'story'
    const context = {
      args: {},
      parameters: { tailwindStyled: { padding: 'p-4' } },
    }
    // In Node environment, it returns StoryFn result
    const result = withTailwindStyled(StoryFn, context)
    expect(result).toBe('story')
  })
})
