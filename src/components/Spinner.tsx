import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

interface SpinnerProps {
  message: string;
  step?: number;
  totalSteps?: number;
  detail?: string;
}

export function Spinner({ message, step, totalSteps, detail }: SpinnerProps) {
  return (
    <Box flexDirection="column" alignItems="center">
      <Box>
        <Text color="cyan">
          <InkSpinner type="dots" />
        </Text>
        <Text> {message}</Text>
        {step !== undefined && totalSteps !== undefined && (
          <Text dimColor> ({step}/{totalSteps})</Text>
        )}
      </Box>
      {detail && (
        <Text dimColor>{detail}</Text>
      )}
    </Box>
  );
}
