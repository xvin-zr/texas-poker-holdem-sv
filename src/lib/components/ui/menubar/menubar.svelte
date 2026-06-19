<script lang="ts">
  import { cn } from '$lib/utils.js';
  import { Menubar as MenubarPrimitive } from 'bits-ui';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: MenubarPrimitive.RootProps = $props();
</script>

<MenubarPrimitive.Root
  bind:ref
  data-slot="menubar"
  class={cn('flex h-8 items-center gap-0.5 rounded-lg border p-[3px]', className)}
  {...restProps}
/>
