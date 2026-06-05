#!/usr/bin/env python3
"""Integration test for Vision Router MCP Server.

This script tests the MCP server by calling it through the MCP protocol.
Run this script after starting the MCP server to verify it works correctly.
"""

import asyncio
import json
import os
import sys

# Add the mcp-servers directory to the path
sys.path.insert(0, 'mcp-servers/vision-router/src')

# Set environment variables
os.environ['MIMO_API_KEY'] = 'tp-c4wh0r649506excggrop9opktgwcnky4lnl69e8gqxvt2zxa'
os.environ['MIMO_API_BASE'] = 'https://token-plan-cn.xiaomimimo.com/anthropic'
os.environ['MIMO_MODEL'] = 'mimo-v2.5'


async def test_vision_router():
    """Test the vision router MCP server."""
    from vision_router_mcp.server import understand_image, get_config

    print("=" * 60)
    print("Vision Router MCP Server - Integration Test")
    print("=" * 60)

    # Test 1: Get configuration
    print("\n1. Testing configuration resource...")
    config = get_config()
    print(f"Configuration:\n{config}")

    # Test 2: Analyze a local image
    print("\n2. Testing local image analysis...")
    try:
        result = await understand_image(
            prompt="Describe this image briefly",
            image_path="screenshots/lobby.png"
        )
        parsed = json.loads(result)
        if parsed.get("success"):
            print(f"[OK] Success! Model: {parsed['metadata']['model']}")
            print(f"  Processing time: {parsed['metadata']['processing_time_ms']}ms")
            print(f"  Description: {parsed['analysis']['description'][:100]}...")
        else:
            print(f"[FAIL] Error: {parsed.get('error')}")
    except Exception as e:
        print(f"[FAIL] Exception: {e}")

    # Test 3: Analyze an image URL
    print("\n3. Testing URL image analysis...")
    try:
        result = await understand_image(
            prompt="What is shown in this image?",
            image_url="https://httpbin.org/image/png"
        )
        parsed = json.loads(result)
        if parsed.get("success"):
            print(f"[OK] Success! Model: {parsed['metadata']['model']}")
            print(f"  Processing time: {parsed['metadata']['processing_time_ms']}ms")
            print(f"  Description: {parsed['analysis']['description'][:100]}...")
        else:
            print(f"[FAIL] Error: {parsed.get('error')}")
    except Exception as e:
        print(f"[FAIL] Exception: {e}")

    # Test 4: Error handling - missing image
    print("\n4. Testing error handling (missing image)...")
    try:
        result = await understand_image(
            prompt="Describe this image"
        )
        parsed = json.loads(result)
        if not parsed.get("success"):
            print(f"[OK] Expected error: {parsed.get('error')}")
            print(f"  Error type: {parsed.get('error_type')}")
        else:
            print("[FAIL] Should have failed with missing image error")
    except Exception as e:
        print(f"[FAIL] Exception: {e}")

    # Test 5: Error handling - nonexistent file
    print("\n5. Testing error handling (nonexistent file)...")
    try:
        result = await understand_image(
            prompt="Describe this image",
            image_path="/nonexistent/image.png"
        )
        parsed = json.loads(result)
        if not parsed.get("success"):
            print(f"[OK] Expected error: {parsed.get('error')}")
            print(f"  Error type: {parsed.get('error_type')}")
        else:
            print("[FAIL] Should have failed with file not found error")
    except Exception as e:
        print(f"[FAIL] Exception: {e}")

    print("\n" + "=" * 60)
    print("Integration test completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_vision_router())
