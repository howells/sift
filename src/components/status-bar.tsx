import { Box, Text } from "ink";

interface KeyBinding {
  key: string;
  label: string;
}

interface StatusBarProps {
  bindings: KeyBinding[];
}

export function StatusBar({ bindings }: StatusBarProps) {
  return (
    <Box
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderTop
      marginTop={1}
      paddingX={1}
    >
      <Box flexGrow={1} gap={1}>
        {bindings.map((binding) => (
          <Text key={binding.key}>
            <Text color="cyan">{binding.key}</Text>
            <Text dimColor> {binding.label}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
