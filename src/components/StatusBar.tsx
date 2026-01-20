import React from "react";
import { Box, Text } from "ink";

interface KeyBinding {
  key: string;
  label: string;
}

interface StatusBarProps {
  bindings: KeyBinding[];
  extraInfo?: string;
}

export function StatusBar({ bindings, extraInfo }: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      marginTop={1}
    >
      <Box flexGrow={1}>
        {bindings.map((binding, i) => (
          <Text key={binding.key}>
            <Text color="cyan">[{binding.key}]</Text>
            <Text dimColor> {binding.label}</Text>
            {i < bindings.length - 1 && <Text>  </Text>}
          </Text>
        ))}
      </Box>
      {extraInfo && <Text dimColor>{extraInfo}</Text>}
    </Box>
  );
}
