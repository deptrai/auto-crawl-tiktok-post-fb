import asyncio
from typing import Optional

def get_error(custom_provider, model_name, api_key, api_base):
    try:
        from langchain_litellm import ChatLiteLLM
        from langchain_core.messages import HumanMessage
        llm = ChatLiteLLM(
            model=f"{custom_provider}/{model_name}",
            api_key=api_key,
            api_base=api_base,
            timeout=30
        )
        msg = HumanMessage(content="Hello")
        
        async def run():
            return await asyncio.wait_for(llm.ainvoke([msg]), timeout=30)
            
        print("RESULT:")
        print(asyncio.run(run()))
    except Exception as e:
        print("ERROR:", str(e))

get_error("deepseek-v3.2", "deepseek-v3.2", "sk-Righ5E8wjF9WMrNITGhjBZlgS17vzdvbxYK4S1IjaJu4soIi", "https://v98store.com")
get_error("openai", "deepseek-v3.2", "sk-Righ5E8wjF9WMrNITGhjBZlgS17vzdvbxYK4S1IjaJu4soIi", "https://v98store.com")
get_error("openai", "deepseek-v3.2", "sk-Righ5E8wjF9WMrNITGhjBZlgS17vzdvbxYK4S1IjaJu4soIi", "https://v98store.com/v1")
